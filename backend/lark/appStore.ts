/**
 * Persisted Feishu / Lark app configurations.
 *
 * Stored at `~/.claude-webui/lark-apps.json`. Each entry is a single
 * Feishu app the bot should connect as. Persisting these lets admins add
 * apps from the web UI (hot reload) instead of baking credentials into the
 * server start command.
 *
 * NOTE: app secrets are stored in plaintext. Treat this file the same way
 * you treat `users.json` — read-only by the server user, no world bits.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { exists, readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

export interface LarkAppRecord {
  /** Stable internal id; lets the admin rename appId without breaking refs. */
  id: string;
  appId: string;
  appSecret: string;
  domain: "feishu" | "lark";
  /** Optional human-friendly label rendered in the admin UI. */
  displayName?: string;
  createdAt: string;
}

export interface PublicLarkApp {
  id: string;
  appId: string;
  domain: "feishu" | "lark";
  displayName?: string;
  createdAt: string;
}

export function publicView(record: LarkAppRecord): PublicLarkApp {
  return {
    id: record.id,
    appId: record.appId,
    domain: record.domain,
    displayName: record.displayName,
    createdAt: record.createdAt,
  };
}

export function defaultAppsPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "lark-apps.json");
}

async function loadFromDisk(path: string): Promise<LarkAppRecord[]> {
  if (!(await exists(path))) return [];
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: LarkAppRecord[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.id !== "string" ||
        typeof rec.appId !== "string" ||
        typeof rec.appSecret !== "string"
      )
        continue;
      const domain =
        rec.domain === "lark" || rec.domain === "feishu"
          ? rec.domain
          : "feishu";
      out.push({
        id: rec.id,
        appId: rec.appId,
        appSecret: rec.appSecret,
        domain,
        displayName:
          typeof rec.displayName === "string" ? rec.displayName : undefined,
        createdAt:
          typeof rec.createdAt === "string"
            ? rec.createdAt
            : new Date().toISOString(),
      });
    }
    return out;
  } catch (error) {
    logger.cli.warn("Failed to read lark apps: {error}", { error });
    return [];
  }
}

async function writeToDisk(
  path: string,
  records: LarkAppRecord[],
): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}

export async function listApps(path: string): Promise<LarkAppRecord[]> {
  return loadFromDisk(path);
}

export interface AddAppInput {
  appId: string;
  appSecret: string;
  domain?: "feishu" | "lark";
  displayName?: string;
}

export class LarkAppMgmtError extends Error {
  constructor(
    message: string,
    public code: "exists" | "invalid" | "not-found",
  ) {
    super(message);
  }
}

export async function addApp(
  path: string,
  input: AddAppInput,
): Promise<LarkAppRecord> {
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  if (!appId || !appSecret) {
    throw new LarkAppMgmtError("appId and appSecret are required", "invalid");
  }
  const existing = await loadFromDisk(path);
  if (existing.some((r) => r.appId === appId)) {
    throw new LarkAppMgmtError(`App ${appId} is already registered`, "exists");
  }
  const record: LarkAppRecord = {
    id: randomUUID(),
    appId,
    appSecret,
    domain: input.domain ?? "feishu",
    displayName: input.displayName?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  existing.push(record);
  await writeToDisk(path, existing);
  return record;
}

export async function removeApp(path: string, id: string): Promise<void> {
  const existing = await loadFromDisk(path);
  const next = existing.filter((r) => r.id !== id);
  if (next.length === existing.length) {
    throw new LarkAppMgmtError(`App ${id} not found`, "not-found");
  }
  await writeToDisk(path, next);
}

/**
 * Idempotent "make sure this app exists" used by the CLI bootstrap path.
 * Returns the record either way. Used when --lark-app-id is supplied on
 * the command line so legacy operators don't lose their app on first run.
 */
export async function upsertApp(
  path: string,
  input: AddAppInput,
): Promise<LarkAppRecord> {
  const existing = await loadFromDisk(path);
  const match = existing.find((r) => r.appId === input.appId.trim());
  if (match) {
    // Update the secret in case the operator rotated it.
    if (match.appSecret !== input.appSecret.trim()) {
      match.appSecret = input.appSecret.trim();
      await writeToDisk(path, existing);
    }
    return match;
  }
  return addApp(path, input);
}
