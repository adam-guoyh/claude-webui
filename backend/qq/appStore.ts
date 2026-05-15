/**
 * Persisted QQ official-bot app configurations.
 *
 * Storage at `~/.claude-webui/qq-apps.json`. Each record is one QQ open
 * platform app the bot should connect as (qqbot.com / 腾讯开放平台).
 * Plaintext secrets — same caveat as `lark-apps.json`.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { exists, readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

export interface QqAppRecord {
  id: string;
  /** "appid" from qqbot.com. Keeps the same field name across providers
   *  so the binding store can be reused. */
  appId: string;
  /**
   * "secret" from qqbot.com. NB: QQ has a separate `token` field too, but
   * the `qq-official-bot` SDK only uses appid+secret for v2 auth, so we
   * skip token. (Older `qq-guild-bot` flows used token; not relevant here.)
   */
  appSecret: string;
  /** True = qq-official-bot's sandbox (test) environment. */
  sandbox?: boolean;
  displayName?: string;
  owner?: string;
  createdAt: string;
}

export interface PublicQqApp {
  id: string;
  appId: string;
  sandbox: boolean;
  displayName?: string;
  owner?: string;
  createdAt: string;
}

export function publicView(record: QqAppRecord): PublicQqApp {
  return {
    id: record.id,
    appId: record.appId,
    sandbox: !!record.sandbox,
    displayName: record.displayName,
    owner: record.owner,
    createdAt: record.createdAt,
  };
}

export function defaultAppsPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "qq-apps.json");
}

export function defaultBindingsPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "qq-bindings.json");
}

async function loadFromDisk(path: string): Promise<QqAppRecord[]> {
  if (!(await exists(path))) return [];
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: QqAppRecord[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.id !== "string" ||
        typeof rec.appId !== "string" ||
        typeof rec.appSecret !== "string"
      )
        continue;
      out.push({
        id: rec.id,
        appId: rec.appId,
        appSecret: rec.appSecret,
        sandbox: typeof rec.sandbox === "boolean" ? rec.sandbox : false,
        displayName:
          typeof rec.displayName === "string" ? rec.displayName : undefined,
        owner: typeof rec.owner === "string" ? rec.owner : undefined,
        createdAt:
          typeof rec.createdAt === "string"
            ? rec.createdAt
            : new Date().toISOString(),
      });
    }
    return out;
  } catch (error) {
    logger.cli.warn("Failed to read qq apps: {error}", { error });
    return [];
  }
}

async function writeToDisk(
  path: string,
  records: QqAppRecord[],
): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}

export async function listApps(path: string): Promise<QqAppRecord[]> {
  return loadFromDisk(path);
}

export interface AddQqAppInput {
  appId: string;
  appSecret: string;
  sandbox?: boolean;
  displayName?: string;
  owner?: string;
}

export class QqAppMgmtError extends Error {
  constructor(
    message: string,
    public code: "exists" | "invalid" | "not-found",
  ) {
    super(message);
  }
}

export async function addApp(
  path: string,
  input: AddQqAppInput,
): Promise<QqAppRecord> {
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  if (!appId || !appSecret) {
    throw new QqAppMgmtError("appId and appSecret are required", "invalid");
  }
  const existing = await loadFromDisk(path);
  if (existing.some((r) => r.appId === appId)) {
    throw new QqAppMgmtError(`App ${appId} is already registered`, "exists");
  }
  const record: QqAppRecord = {
    id: randomUUID(),
    appId,
    appSecret,
    sandbox: !!input.sandbox,
    displayName: input.displayName?.trim() || undefined,
    owner: input.owner?.trim() || undefined,
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
    throw new QqAppMgmtError(`App ${id} not found`, "not-found");
  }
  await writeToDisk(path, next);
}
