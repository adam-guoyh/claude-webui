/**
 * JSON-file store for scheduled rate-limit retries.
 *
 * Lives at `~/.claude-webui/pending-retries.json`. The webui process is the
 * single writer, so no locking — atomic tmp-file + rename gives crash safety.
 * Format on disk:
 *
 *   { "retries": PendingRetry[] }
 *
 * Admin can see the full list; regular users only see their own — gating
 * lives in the HTTP layer, not here.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import type { PendingRetry } from "../../shared/types.ts";
import { exists, readTextFile, writeTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

const FILE_NAME = "pending-retries.json";

function storePath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", FILE_NAME);
}

interface OnDisk {
  retries: PendingRetry[];
}

function isValidEntry(value: unknown): value is PendingRetry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.owner === null || typeof v.owner === "string") &&
    typeof v.encodedProjectName === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.workingDirectory === "string" &&
    typeof v.content === "string" &&
    typeof v.dueAt === "number" &&
    typeof v.createdAt === "number" &&
    (v.model === undefined || typeof v.model === "string") &&
    (v.permissionMode === undefined || typeof v.permissionMode === "string")
  );
}

/** Load the full retry list. Returns [] on missing/corrupt file — never throws,
 *  since a malformed JSON blob shouldn't take down the boot path. */
export async function loadAll(): Promise<PendingRetry[]> {
  const path = storePath();
  try {
    if (!(await exists(path))) return [];
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as OnDisk).retries)
    ) {
      logger.cli.warn("pending-retries.json malformed; ignoring");
      return [];
    }
    const out: PendingRetry[] = [];
    for (const entry of (parsed as OnDisk).retries) {
      if (isValidEntry(entry)) out.push(entry);
    }
    return out;
  } catch (error) {
    logger.cli.warn(
      "Failed to read pending-retries store: {error}",
      { error },
    );
    return [];
  }
}

async function saveAll(retries: PendingRetry[]): Promise<void> {
  const path = storePath();
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await writeTextFile(tmp, JSON.stringify({ retries }, null, 2));
  // chmod 600 — same handling as users.json / lark-apps.json. We don't expose
  // user content beyond the calling process, but secrets-style perms are the
  // safe default for files under ~/.claude-webui.
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    // Some filesystems (e.g. NTFS via WSL) reject chmod; non-fatal.
  }
  await fs.rename(tmp, path);
}

export async function addEntry(entry: PendingRetry): Promise<void> {
  const all = await loadAll();
  all.push(entry);
  await saveAll(all);
}

export async function removeEntry(id: string): Promise<PendingRetry | null> {
  const all = await loadAll();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const [removed] = all.splice(i, 1);
  await saveAll(all);
  return removed;
}

export async function getEntry(id: string): Promise<PendingRetry | null> {
  const all = await loadAll();
  return all.find((e) => e.id === id) ?? null;
}
