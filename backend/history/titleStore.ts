/**
 * Per-project store of user-defined session titles.
 *
 * Custom titles live alongside Claude's own JSONL history files at
 *   ~/.claude/projects/<encodedProjectName>/.webui-titles.json
 * keyed by sessionId. We keep them out of the JSONL itself so the Claude
 * CLI's own session files stay pristine.
 *
 * This is a local single-user tool — no locking is needed. Writes happen
 * via tmp-file + rename for crash-safety.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { exists, readTextFile, writeTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

const TITLES_FILE = ".webui-titles.json";
const MAX_TITLE_LENGTH = 200;

export type TitleMap = Record<string, string>;

function projectDir(encodedProjectName: string): string {
  const homeDir = getHomeDir();
  if (!homeDir) {
    throw new Error("Home directory not found");
  }
  return join(homeDir, ".claude", "projects", encodedProjectName);
}

function titlesPath(encodedProjectName: string): string {
  return join(projectDir(encodedProjectName), TITLES_FILE);
}

/**
 * Read the title map for a project. Returns `{}` when the file is missing,
 * unreadable, or malformed — never throws on read errors so a corrupt JSON
 * blob can't take down the histories endpoint.
 */
export async function loadTitles(
  encodedProjectName: string,
): Promise<TitleMap> {
  const path = titlesPath(encodedProjectName);
  try {
    if (!(await exists(path))) return {};
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: TitleMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch (error) {
    logger.history.warn("Failed to read title store for {project}: {error}", {
      project: encodedProjectName,
      error,
    });
    return {};
  }
}

/**
 * Set the custom title for a session, or clear it when `title` is null/empty.
 * Returns the updated TitleMap.
 */
export async function setTitle(
  encodedProjectName: string,
  sessionId: string,
  title: string | null,
): Promise<TitleMap> {
  const titles = await loadTitles(encodedProjectName);

  const normalized =
    title === null ? null : title.trim().slice(0, MAX_TITLE_LENGTH);

  if (!normalized) {
    delete titles[sessionId];
  } else {
    titles[sessionId] = normalized;
  }

  const path = titlesPath(encodedProjectName);
  const tmpPath = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await writeTextFile(tmpPath, JSON.stringify(titles, null, 2));
  await fs.rename(tmpPath, path);

  return titles;
}
