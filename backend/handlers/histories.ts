import { promises as fs } from "node:fs";
import { Context } from "hono";
import type {
  ConversationSummary,
  HistoryListResponse,
  SessionOwnerRequest,
  SessionTitleRequest,
} from "../../shared/types.ts";
import { validateEncodedProjectName } from "../history/pathUtils.ts";
import { parseAllHistoryFiles } from "../history/parser.ts";
import { groupConversations } from "../history/grouping.ts";
import { loadTitles, setTitle } from "../history/titleStore.ts";
import {
  getOwner,
  loadOwners,
  removeOwner,
  setOwner,
} from "../history/ownershipStore.ts";
import { getUserRole } from "../auth/userStore.ts";
import { logger } from "../utils/logger.ts";
import { exists, stat } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

type CallerRole = "admin" | "user" | "open";

/**
 * Resolve the caller's role for ownership-aware operations.
 *
 * - `open`: auth is disabled — everyone is effectively admin
 * - `admin` / `user`: as recorded in the users file
 *
 * Sessions issued via the legacy shared bearer token have `authUser === null`
 * but a configured users file. We treat that as `open` for backward-compat
 * since the token holder is implicitly trusted.
 */
async function resolveRole(c: Context): Promise<CallerRole> {
  const usersFile = (c.var.config as { usersFile?: string } | undefined)
    ?.usersFile;
  if (!usersFile) return "open";
  const user = c.var.authUser as string | null;
  if (!user) return "open";
  const role = await getUserRole(usersFile, user);
  return role === "admin" ? "admin" : "user";
}

function projectDir(encodedProjectName: string): string {
  const homeDir = getHomeDir();
  if (!homeDir) throw new Error("Home directory not found");
  return `${homeDir}/.claude/projects/${encodedProjectName}`;
}

async function projectDirExists(encodedProjectName: string): Promise<boolean> {
  try {
    const dirInfo = await stat(projectDir(encodedProjectName));
    return dirInfo.isDirectory;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No such file")) {
      return false;
    }
    throw error;
  }
}

/**
 * GET /api/projects/:encodedProjectName/histories
 *
 * Lists conversations for a project. Filters by ownership: regular users see
 * only sessions they own; admins see everything with an `owner` field;
 * unauthenticated callers (auth disabled or legacy shared token) see all.
 */
export async function handleHistoriesRequest(c: Context) {
  try {
    const encodedProjectName = c.req.param("encodedProjectName");

    if (!encodedProjectName) {
      return c.json({ error: "Encoded project name is required" }, 400);
    }
    if (!validateEncodedProjectName(encodedProjectName)) {
      return c.json({ error: "Invalid encoded project name" }, 400);
    }

    logger.history.debug(
      `Fetching histories for encoded project: ${encodedProjectName}`,
    );

    const homeDir = getHomeDir();
    if (!homeDir) return c.json({ error: "Home directory not found" }, 500);
    if (!(await projectDirExists(encodedProjectName))) {
      return c.json({ error: "Project not found" }, 404);
    }

    const conversationFiles = await parseAllHistoryFiles(
      projectDir(encodedProjectName),
    );
    const grouped = groupConversations(conversationFiles);

    const titles = await loadTitles(encodedProjectName);
    const owners = await loadOwners(encodedProjectName);
    const role = await resolveRole(c);
    const caller = c.var.authUser as string | null;

    let conversations: ConversationSummary[] = grouped.map((s) => {
      const customTitle = titles[s.sessionId];
      const owner = owners[s.sessionId];
      return {
        ...s,
        ...(customTitle ? { customTitle } : {}),
        // The frontend only shows `owner` for admins; regular users never
        // see anyone else's sessions, so leaking it on their own rows is
        // harmless but redundant. Including it unconditionally for admins.
        ...(role === "admin" && owner ? { owner } : {}),
      };
    });

    if (role === "user") {
      conversations = conversations.filter(
        (s) => owners[s.sessionId] === caller,
      );
    }

    const response: HistoryListResponse = { conversations };
    return c.json(response);
  } catch (error) {
    logger.history.error("Error fetching conversation histories: {error}", {
      error,
    });
    return c.json(
      {
        error: "Failed to fetch conversation histories",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

/**
 * PUT /api/projects/:encodedProjectName/sessions/:sessionId/title
 *
 * Body: `{ "title": string | null }`. Empty/null clears the custom title.
 */
export async function handleSetSessionTitleRequest(c: Context) {
  try {
    const encodedProjectName = c.req.param("encodedProjectName");
    const sessionId = c.req.param("sessionId");

    if (!encodedProjectName || !sessionId) {
      return c.json({ error: "Project name and session id are required" }, 400);
    }
    if (!validateEncodedProjectName(encodedProjectName)) {
      return c.json({ error: "Invalid encoded project name" }, 400);
    }
    if (!(await projectDirExists(encodedProjectName))) {
      return c.json({ error: "Project not found" }, 404);
    }

    const role = await resolveRole(c);
    const caller = c.var.authUser as string | null;
    if (role === "user") {
      const owner = await getOwner(encodedProjectName, sessionId);
      if (owner !== caller) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    const body = (await c.req.json()) as SessionTitleRequest;
    if (
      body === null ||
      typeof body !== "object" ||
      !("title" in body) ||
      !(typeof body.title === "string" || body.title === null)
    ) {
      return c.json({ error: "Body must be { title: string | null }" }, 400);
    }

    const updated = await setTitle(encodedProjectName, sessionId, body.title);
    return c.json({ sessionId, customTitle: updated[sessionId] ?? null });
  } catch (error) {
    logger.history.error("Error setting session title: {error}", { error });
    return c.json(
      {
        error: "Failed to set session title",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

/**
 * DELETE /api/projects/:encodedProjectName/sessions/:sessionId
 *
 * Removes the JSONL session file from disk, plus its title and ownership
 * entries. Regular users may only delete sessions they own; admins (or
 * shared-token / open callers) may delete anything.
 */
export async function handleDeleteSessionRequest(c: Context) {
  try {
    const encodedProjectName = c.req.param("encodedProjectName");
    const sessionId = c.req.param("sessionId");

    if (!encodedProjectName || !sessionId) {
      return c.json({ error: "Project name and session id are required" }, 400);
    }
    if (!validateEncodedProjectName(encodedProjectName)) {
      return c.json({ error: "Invalid encoded project name" }, 400);
    }
    // Defensive: refuse anything that could escape the project directory.
    if (sessionId.includes("/") || sessionId.includes("..")) {
      return c.json({ error: "Invalid session id" }, 400);
    }
    if (!(await projectDirExists(encodedProjectName))) {
      return c.json({ error: "Project not found" }, 404);
    }

    const role = await resolveRole(c);
    const caller = c.var.authUser as string | null;
    if (role === "user") {
      const owner = await getOwner(encodedProjectName, sessionId);
      if (owner !== caller) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    const filePath = `${projectDir(encodedProjectName)}/${sessionId}.jsonl`;
    if (await exists(filePath)) {
      await fs.unlink(filePath);
    }
    // Even if the JSONL was already gone, drop the metadata so listings stay
    // tidy.
    await setTitle(encodedProjectName, sessionId, null);
    await removeOwner(encodedProjectName, sessionId);
    return c.json({ ok: true });
  } catch (error) {
    logger.history.error("Error deleting session: {error}", { error });
    return c.json(
      {
        error: "Failed to delete session",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

/**
 * PUT /api/projects/:encodedProjectName/sessions/:sessionId/owner — admin
 * only. Reassigns a session to another user (or clears ownership when
 * `owner: null`).
 *
 * This is a metadata-only move; the on-disk JSONL is unchanged so Claude
 * can still resume the session by id.
 */
export async function handleSetSessionOwnerRequest(c: Context) {
  try {
    const encodedProjectName = c.req.param("encodedProjectName");
    const sessionId = c.req.param("sessionId");

    if (!encodedProjectName || !sessionId) {
      return c.json({ error: "Project name and session id are required" }, 400);
    }
    if (!validateEncodedProjectName(encodedProjectName)) {
      return c.json({ error: "Invalid encoded project name" }, 400);
    }
    if (!(await projectDirExists(encodedProjectName))) {
      return c.json({ error: "Project not found" }, 404);
    }

    const role = await resolveRole(c);
    if (role !== "admin" && role !== "open") {
      return c.json({ error: "Admin only" }, 403);
    }

    const body = (await c.req.json()) as SessionOwnerRequest;
    if (
      body === null ||
      typeof body !== "object" ||
      !("owner" in body) ||
      !(typeof body.owner === "string" || body.owner === null)
    ) {
      return c.json({ error: "Body must be { owner: string | null }" }, 400);
    }

    if (body.owner === null || body.owner === "") {
      await removeOwner(encodedProjectName, sessionId);
      return c.json({ sessionId, owner: null });
    }
    await setOwner(encodedProjectName, sessionId, body.owner);
    return c.json({ sessionId, owner: body.owner });
  } catch (error) {
    logger.history.error("Error setting session owner: {error}", { error });
    return c.json(
      {
        error: "Failed to set session owner",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
