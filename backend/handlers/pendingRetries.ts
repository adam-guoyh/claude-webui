/**
 * HTTP handlers for the server-side rate-limit auto-resume queue.
 *
 *   GET  /api/pending-retries        — list (own for users, all for admins)
 *   POST /api/pending-retries        — schedule a new retry
 *   DELETE /api/pending-retries/:id  — cancel
 *
 * The handlers themselves enforce admin-vs-user visibility; lower-level store
 * and scheduler stay role-agnostic.
 */

import { Context } from "hono";
import { randomUUID } from "node:crypto";
import type {
  PendingRetry,
  PendingRetryCreateRequest,
  PendingRetryListResponse,
} from "../../shared/types.ts";
import { getUserRole } from "../auth/userStore.ts";
import { addEntry, getEntry, loadAll, removeEntry } from "../pendingRetries/store.ts";
import { cancel, schedule } from "../pendingRetries/scheduler.ts";
import { validateEncodedProjectName } from "../history/pathUtils.ts";
import { logger } from "../utils/logger.ts";

type CallerRole = "admin" | "user" | "open";

async function resolveRole(c: Context): Promise<CallerRole> {
  const usersFile = (c.var.config as { usersFile?: string } | undefined)
    ?.usersFile;
  if (!usersFile) return "open";
  const user = c.var.authUser as string | null;
  if (!user) return "open";
  const role = await getUserRole(usersFile, user);
  return role === "admin" ? "admin" : "user";
}

/** Owner-or-admin gate: an admin sees all, the original owner sees its own,
 *  open mode sees all (no users → no notion of ownership). */
function canSee(entry: PendingRetry, caller: string | null, role: CallerRole): boolean {
  if (role === "admin" || role === "open") return true;
  return entry.owner !== null && entry.owner === caller;
}

export async function handleListPendingRetries(c: Context) {
  try {
    const caller = c.var.authUser as string | null;
    const role = await resolveRole(c);
    const all = await loadAll();
    const visible = all.filter((e) => canSee(e, caller, role));
    const body: PendingRetryListResponse = { retries: visible };
    return c.json(body);
  } catch (error) {
    logger.cli.error("Failed to list pending retries: {error}", { error });
    return c.json({ error: "Failed to list pending retries" }, 500);
  }
}

export async function handleCreatePendingRetry(c: Context) {
  try {
    const body = (await c.req.json()) as Partial<PendingRetryCreateRequest>;
    const {
      encodedProjectName,
      sessionId,
      workingDirectory,
      content,
      model,
      permissionMode,
      dueAt,
    } = body;

    if (
      typeof encodedProjectName !== "string" ||
      !validateEncodedProjectName(encodedProjectName)
    ) {
      return c.json({ error: "Invalid encodedProjectName" }, 400);
    }
    if (typeof sessionId !== "string" || !sessionId) {
      return c.json({ error: "sessionId required" }, 400);
    }
    if (typeof workingDirectory !== "string" || !workingDirectory) {
      return c.json({ error: "workingDirectory required" }, 400);
    }
    if (typeof content !== "string" || !content.trim()) {
      return c.json({ error: "content required" }, 400);
    }
    if (typeof dueAt !== "number" || !Number.isFinite(dueAt)) {
      return c.json({ error: "dueAt required" }, 400);
    }

    const caller = (c.var.authUser as string | null) ?? null;
    const cliPath = (c.var.config as { cliPath: string }).cliPath;

    const entry: PendingRetry = {
      id: randomUUID(),
      owner: caller,
      encodedProjectName,
      sessionId,
      workingDirectory,
      content,
      ...(typeof model === "string" && model ? { model } : {}),
      ...(typeof permissionMode === "string" && permissionMode
        ? { permissionMode }
        : {}),
      dueAt,
      createdAt: Date.now(),
    };

    await addEntry(entry);
    schedule(entry, cliPath);
    return c.json({ id: entry.id, retry: entry }, 201);
  } catch (error) {
    logger.cli.error("Failed to create pending retry: {error}", { error });
    return c.json({ error: "Failed to create pending retry" }, 500);
  }
}

export async function handleDeletePendingRetry(c: Context) {
  try {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);

    const caller = c.var.authUser as string | null;
    const role = await resolveRole(c);
    const entry = await getEntry(id);
    if (!entry) return c.json({ error: "Not found" }, 404);
    if (!canSee(entry, caller, role)) {
      // Regular users can only cancel their own; surface 404 (not 403) so we
      // don't disclose existence of other users' entries.
      return c.json({ error: "Not found" }, 404);
    }

    cancel(id);
    await removeEntry(id);
    return c.json({ ok: true });
  } catch (error) {
    logger.cli.error("Failed to delete pending retry: {error}", { error });
    return c.json({ error: "Failed to delete pending retry" }, 500);
  }
}
