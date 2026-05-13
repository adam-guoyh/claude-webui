import { Context } from "hono";
import type {
  ConversationSummary,
  HistoryListResponse,
  SessionTitleRequest,
} from "../../shared/types.ts";
import { validateEncodedProjectName } from "../history/pathUtils.ts";
import { parseAllHistoryFiles } from "../history/parser.ts";
import { groupConversations } from "../history/grouping.ts";
import { loadTitles, setTitle } from "../history/titleStore.ts";
import { logger } from "../utils/logger.ts";
import { stat } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

/**
 * Handles GET /api/projects/:encodedProjectName/histories requests
 * Fetches conversation history list for a specific project
 * @param c - Hono context object with config variables
 * @returns JSON response with conversation history list
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

    // Get home directory
    const homeDir = getHomeDir();
    if (!homeDir) {
      return c.json({ error: "Home directory not found" }, 500);
    }

    // Build history directory path directly from encoded name
    const historyDir = `${homeDir}/.claude/projects/${encodedProjectName}`;

    logger.history.debug(`History directory: ${historyDir}`);

    // Check if the directory exists
    try {
      const dirInfo = await stat(historyDir);
      if (!dirInfo.isDirectory) {
        return c.json({ error: "Project not found" }, 404);
      }
    } catch (error) {
      // Handle file not found errors in a cross-platform way
      if (error instanceof Error && error.message.includes("No such file")) {
        return c.json({ error: "Project not found" }, 404);
      }
      throw error;
    }

    const conversationFiles = await parseAllHistoryFiles(historyDir);

    logger.history.debug(
      `Found ${conversationFiles.length} conversation files`,
    );

    // Group conversations and remove duplicates
    const grouped = groupConversations(conversationFiles);

    logger.history.debug(
      `After grouping: ${grouped.length} unique conversations`,
    );

    // Merge custom titles into the response (no-op when the title file is
    // missing or malformed — see titleStore for the silent-fallback behavior).
    const titles = await loadTitles(encodedProjectName);
    const conversations: ConversationSummary[] = grouped.map((c) =>
      titles[c.sessionId] ? { ...c, customTitle: titles[c.sessionId] } : c,
    );

    const response: HistoryListResponse = {
      conversations,
    };

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
 * Returns the (possibly empty) string actually persisted.
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

    // Confirm the project directory exists before persisting a title for it.
    const homeDir = getHomeDir();
    if (!homeDir) return c.json({ error: "Home directory not found" }, 500);
    const historyDir = `${homeDir}/.claude/projects/${encodedProjectName}`;
    try {
      const dirInfo = await stat(historyDir);
      if (!dirInfo.isDirectory) {
        return c.json({ error: "Project not found" }, 404);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("No such file")) {
        return c.json({ error: "Project not found" }, 404);
      }
      throw error;
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
