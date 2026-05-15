/**
 * Helpers used by the bot's `/list` and `/resume` commands.
 *
 * Reads the same Claude JSONL transcript files the webui sidebar reads,
 * filtered to sessions owned by the bound webui user under the current
 * working directory. The aim is to let a user pick up a session they
 * started in the browser from inside Feishu.
 */

import { getEncodedProjectName } from "../history/pathUtils.ts";
import { parseAllHistoryFiles } from "../history/parser.ts";
import { groupConversations } from "../history/grouping.ts";
import { loadTitles } from "../history/titleStore.ts";
import { loadOwners } from "../history/ownershipStore.ts";
import { getHomeDir } from "../utils/os.ts";
import { stat } from "../utils/fs.ts";

export interface SessionRow {
  sessionId: string;
  /** ISO string of the most-recent message in the session. */
  lastTime: string;
  messageCount: number;
  /** First few characters of the latest text — for /list output. */
  lastMessagePreview: string;
  /** User-defined title set via the rename API, if any. */
  customTitle?: string;
}

async function projectDirExists(encodedProjectName: string): Promise<boolean> {
  try {
    const home = getHomeDir();
    if (!home) return false;
    const info = await stat(`${home}/.claude/projects/${encodedProjectName}`);
    return info.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Return the user's sessions for the given working directory, newest first.
 * Returns an empty array when the project dir doesn't exist yet (user hasn't
 * chatted there before).
 */
export async function listUserSessionsInCwd(
  cwd: string,
  username: string,
): Promise<SessionRow[]> {
  const encoded = await getEncodedProjectName(cwd);
  if (!encoded) return [];
  if (!(await projectDirExists(encoded))) return [];

  const home = getHomeDir();
  if (!home) return [];

  const conversationFiles = await parseAllHistoryFiles(
    `${home}/.claude/projects/${encoded}`,
  );
  const grouped = groupConversations(conversationFiles);
  const titles = await loadTitles(encoded);
  const owners = await loadOwners(encoded);

  const mine = grouped.filter((s) => owners[s.sessionId] === username);
  // Newest first.
  mine.sort(
    (a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime(),
  );

  return mine.map((s) => ({
    sessionId: s.sessionId,
    lastTime: s.lastTime,
    messageCount: s.messageCount,
    lastMessagePreview: s.lastMessagePreview,
    customTitle: titles[s.sessionId],
  }));
}
