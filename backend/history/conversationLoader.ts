/**
 * Individual conversation loading utilities
 * Handles loading and parsing specific conversation files
 */

import { stat as fsStat } from "node:fs/promises";
import type { RawHistoryLine } from "./parser.ts";
import type { ConversationHistory } from "../../shared/types.ts";
import { logger } from "../utils/logger.ts";
import { processConversationMessages } from "./timestampRestore.ts";
import { validateEncodedProjectName } from "./pathUtils.ts";
import { readTextFile, exists } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

/**
 * mtime+size keyed cache for parsed ConversationHistory. Hits skip both
 * the 16-MB file read and the per-line JSON.parse loop. Append-only
 * semantics make (mtime,size) a safe staleness signal.
 */
const conversationCache = new Map<
  string,
  { mtime: number; size: number; data: ConversationHistory }
>();
const CONVERSATION_CACHE_MAX = 8;

function rememberConversation(
  filePath: string,
  mtime: number,
  size: number,
  data: ConversationHistory,
): void {
  if (conversationCache.size >= CONVERSATION_CACHE_MAX) {
    const oldest = conversationCache.keys().next().value;
    if (oldest !== undefined) conversationCache.delete(oldest);
  }
  conversationCache.set(filePath, { mtime, size, data });
}

/**
 * Load a specific conversation by session ID with optional pagination
 * @param encodedProjectName - Encoded project name
 * @param sessionId - Session ID
 * @param limit - Number of messages to return (default: 30 for recent messages)
 * @param offset - Skip this many messages from the end (for loading older messages)
 */
export async function loadConversation(
  encodedProjectName: string,
  sessionId: string,
  limit?: number,
  offset?: number,
): Promise<ConversationHistory | null> {
  // Validate inputs
  if (!validateEncodedProjectName(encodedProjectName)) {
    throw new Error("Invalid encoded project name");
  }

  if (!validateSessionId(sessionId)) {
    throw new Error("Invalid session ID format");
  }

  // Get home directory
  const homeDir = getHomeDir();
  if (!homeDir) {
    throw new Error("Home directory not found");
  }

  // Build file path
  const historyDir = `${homeDir}/.claude/projects/${encodedProjectName}`;
  const filePath = `${historyDir}/${sessionId}.jsonl`;

  // Check if file exists before trying to read it
  if (!(await exists(filePath))) {
    return null; // Session not found
  }

  // mtime+size cache: re-fetch only when the JSONL has actually changed.
  // The cache key must include `limit` and `offset` — without them the same
  // entry would satisfy every page, so paginated requests would all return
  // the initial-load batch. Each (file, window) pair gets its own entry,
  // invalidated together when the JSONL changes.
  const cacheKey = `${filePath}|${limit ?? "all"}|${offset ?? 0}`;
  let mtime = 0;
  let size = 0;
  try {
    const info = await fsStat(filePath);
    mtime = info.mtime?.getTime() ?? 0;
    size = info.size;
    const cached = conversationCache.get(cacheKey);
    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.data;
    }
  } catch {
    // Stat failure is non-fatal — fall through to the full read.
  }

  try {
    const conversationHistory = await parseConversationFile(
      filePath,
      sessionId,
      limit,
      offset,
    );
    if (mtime || size) {
      rememberConversation(cacheKey, mtime, size, conversationHistory);
    }
    return conversationHistory;
  } catch (error) {
    throw error; // Re-throw any parsing errors
  }
}

/**
 * Parse a specific conversation file
 * Converts JSONL lines to timestamped SDK messages
 * @param filePath - Path to the conversation file
 * @param sessionId - Session ID
 * @param limit - Number of messages to return (default: 30 for recent messages)
 * @param offset - Skip this many messages from the end (for loading older messages)
 */
async function parseConversationFile(
  filePath: string,
  sessionId: string,
  limit: number = 30,
  offset: number = 0,
): Promise<ConversationHistory> {
  const content = await readTextFile(filePath);
  const lines = content
    .trim()
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error("Empty conversation file");
  }

  const rawLines: RawHistoryLine[] = [];
  // Valid message types that the frontend can handle
  const validTypes = new Set(["system", "assistant", "user", "result"]);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      // Only include messages with timestamp and valid type
      if (
        parsed &&
        typeof parsed === "object" &&
        "timestamp" in parsed &&
        "type" in parsed &&
        "sessionId" in parsed &&
        validTypes.has((parsed as { type: string }).type)
      ) {
        rawLines.push(parsed as RawHistoryLine);
      }
    } catch (parseError) {
      logger.history.error(`Failed to parse line in ${filePath}: {error}`, {
        error: parseError,
      });
      // Continue processing other lines
    }
  }

  // Apply pagination: take from end (most recent first, then older)
  const totalCount = rawLines.length;
  const startIdx = Math.max(0, totalCount - limit - offset);
  const endIdx = Math.max(0, totalCount - offset);
  const paginatedLines = rawLines.slice(startIdx, endIdx);

  // Process messages (restore timestamps, sort, etc.)
  const { messages: processedMessages, metadata } = processConversationMessages(
    paginatedLines,
    sessionId,
  );

  return {
    sessionId,
    messages: processedMessages,
    metadata: {
      ...metadata,
      totalMessageCount: totalCount,
    },
  };
}

/**
 * Validate session ID format
 * Should be a valid filename without dangerous characters
 */
function validateSessionId(sessionId: string): boolean {
  // Should not be empty
  if (!sessionId) {
    return false;
  }

  // Should not contain dangerous characters for filenames
  // deno-lint-ignore no-control-regex
  const dangerousChars = /[<>:"|?*\x00-\x1f\/\\]/;
  if (dangerousChars.test(sessionId)) {
    return false;
  }

  // Should not be too long (reasonable filename length)
  if (sessionId.length > 255) {
    return false;
  }

  // Should not start with dots (hidden files)
  if (sessionId.startsWith(".")) {
    return false;
  }

  return true;
}

/**
 * Check if a conversation exists without loading it
 */
export async function conversationExists(
  encodedProjectName: string,
  sessionId: string,
): Promise<boolean> {
  try {
    const conversation = await loadConversation(encodedProjectName, sessionId);
    return conversation !== null;
  } catch {
    return false;
  }
}
