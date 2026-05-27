/**
 * JSONL file parsing utilities for conversation history
 * Handles reading and parsing Claude conversation history files
 */

import { stat as fsStat } from "node:fs/promises";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-code";
import { logger } from "../utils/logger.ts";
import { readTextFile, readDir } from "../utils/fs.ts";

// Raw JSONL line structure from Claude history files
export interface RawHistoryLine {
  type: "user" | "assistant" | "system" | "result";
  message?: SDKUserMessage["message"] | SDKAssistantMessage["message"];
  sessionId: string;
  timestamp: string; // ISO string format
  uuid: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  version?: string;
  requestId?: string;
}

/**
 * Slim per-file summary returned by `parseAllHistoryFiles` — enough to
 * group + render the sidebar without holding every parsed JSONL line in
 * memory. The list endpoint reads every session file in a project, so
 * keeping the full message array around once made a single request to a
 * busy project allocate hundreds of MB.
 */
export interface ConversationFile {
  sessionId: string;
  filePath: string;
  messageIds: Set<string>;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
}

/**
 * mtime+size keyed in-memory cache for parsed JSONL summaries. Hits skip
 * file IO and JSON.parse entirely. Session files only grow by append, so
 * the (mtime, size) pair is a faithful "did this change?" signal.
 */
const summaryCache = new Map<
  string,
  { mtime: number; size: number; data: ConversationFile }
>();
const SUMMARY_CACHE_MAX = 256;

function rememberSummary(
  filePath: string,
  mtime: number,
  size: number,
  data: ConversationFile,
): void {
  if (summaryCache.size >= SUMMARY_CACHE_MAX) {
    const oldest = summaryCache.keys().next().value;
    if (oldest !== undefined) summaryCache.delete(oldest);
  }
  summaryCache.set(filePath, { mtime, size, data });
}

/**
 * Parse a single JSONL file and extract conversation data
 * @private - Internal function used by parseAllHistoryFiles
 */
async function parseHistoryFile(
  filePath: string,
): Promise<ConversationFile | null> {
  // mtime + size keyed cache. Session JSONL files are append-only so a
  // (mtime, size) match means "we already have an up-to-date summary for
  // this file" — skip re-reading and re-parsing entirely.
  let mtime = 0;
  let size = 0;
  try {
    const info = await fsStat(filePath);
    mtime = info.mtime?.getTime() ?? 0;
    size = info.size;
    const cached = summaryCache.get(filePath);
    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.data;
    }
  } catch {
    // If stat fails, fall through and let readTextFile surface a real error.
  }

  try {
    const content = await readTextFile(filePath);
    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line.trim());

    if (lines.length === 0) {
      return null; // Empty file
    }

    const messageIds = new Set<string>();
    let startTime = "";
    let lastTime = "";
    let lastMessagePreview = "";
    let messageCount = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RawHistoryLine;
        messageCount++;

        // Track message IDs from assistant messages
        if (parsed.message?.role === "assistant" && parsed.message?.id) {
          messageIds.add(parsed.message.id);
        }

        // Track timestamps
        if (!startTime || parsed.timestamp < startTime) {
          startTime = parsed.timestamp;
        }
        if (!lastTime || parsed.timestamp > lastTime) {
          lastTime = parsed.timestamp;
        }

        // Extract last message preview (from assistant messages)
        if (parsed.message?.role === "assistant" && parsed.message?.content) {
          const content = parsed.message.content;
          if (Array.isArray(content)) {
            // Handle array format content
            for (const item of content) {
              if (typeof item === "object" && item && "text" in item) {
                lastMessagePreview = String(item.text).substring(0, 100);
                break;
              }
            }
          } else if (typeof content === "string") {
            lastMessagePreview = content.substring(0, 100);
          }
        }
      } catch (parseError) {
        logger.history.error(`Failed to parse line in ${filePath}: {error}`, {
          error: parseError,
        });
        // Continue processing other lines
      }
    }

    // Extract session ID from file name (remove .jsonl extension)
    const fileName = filePath.split("/").pop() || "";
    const sessionId = fileName.replace(".jsonl", "");

    // Drop "stub" sessions that contain no assistant text. Claude CLI writes
    // these companion JSONL files for sidechains, aborted turns, summaries
    // etc.; they're never useful as standalone entries in the sidebar and the
    // grouping algorithm doesn't filter them since their empty messageIds
    // can't be a strict subset of an empty-or-smaller set. We just refuse to
    // return them at parse time.
    if (!lastMessagePreview) {
      return null;
    }

    const summary: ConversationFile = {
      sessionId,
      filePath,
      messageIds,
      startTime,
      lastTime,
      messageCount,
      lastMessagePreview,
    };
    if (mtime || size) rememberSummary(filePath, mtime, size, summary);
    return summary;
  } catch (error) {
    logger.history.error(`Failed to read history file ${filePath}: {error}`, {
      error,
    });
    return null;
  }
}

/**
 * Get all JSONL files in a history directory
 * @private - Internal function used by parseAllHistoryFiles
 */
async function getHistoryFiles(historyDir: string): Promise<string[]> {
  try {
    const files: string[] = [];

    for await (const entry of readDir(historyDir)) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        files.push(`${historyDir}/${entry.name}`);
      }
    }

    return files;
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }
}

/**
 * Parse all conversation files in a history directory
 * Used by the histories endpoint to get conversation summaries
 */
export async function parseAllHistoryFiles(
  historyDir: string,
): Promise<ConversationFile[]> {
  const filePaths = await getHistoryFiles(historyDir);
  // Parse files in parallel. Each call is mostly file-IO + JSON.parse; the
  // sequential loop here used to serialise a project's worth of sessions
  // (10s of MB of JSONL) into one cold start when nothing was cached.
  const parsed = await Promise.all(filePaths.map((p) => parseHistoryFile(p)));
  return parsed.filter((x): x is ConversationFile => x !== null);
}

/**
 * Check if one set of message IDs is a subset of another
 */
export function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  if (subset.size > superset.size) {
    return false;
  }

  for (const item of subset) {
    if (!superset.has(item)) {
      return false;
    }
  }

  return true;
}
