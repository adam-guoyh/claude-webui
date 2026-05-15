/**
 * Persisted Feishu open_id ↔ webui username binding.
 *
 * Stored at `~/.claude-webui/lark-bindings.json`. Each entry tracks the
 * mapped webui username, the working directory the bot should hand to
 * Claude, and the active sessionId so multi-turn conversations resume
 * across bot restarts.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { exists, readTextFile, stat } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

export interface LarkBinding {
  username: string;
  cwd: string;
  sessionId?: string;
}

interface BindingFile {
  [openId: string]: LarkBinding;
}

export function defaultBindingPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "lark-bindings.json");
}

let cache: { path: string; mtime: number; data: BindingFile } | null = null;

async function loadFromDisk(path: string): Promise<BindingFile> {
  if (!(await exists(path))) return {};
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: BindingFile = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      if (typeof rec.username !== "string" || typeof rec.cwd !== "string") {
        continue;
      }
      out[k] = {
        username: rec.username,
        cwd: rec.cwd,
        sessionId:
          typeof rec.sessionId === "string" ? rec.sessionId : undefined,
      };
    }
    return out;
  } catch (error) {
    logger.cli.warn("Failed to read lark bindings: {error}", { error });
    return {};
  }
}

export async function loadBindings(path: string): Promise<BindingFile> {
  try {
    const info = await stat(path);
    const mtime = info.mtime?.getTime() ?? 0;
    if (cache && cache.path === path && cache.mtime === mtime) {
      return { ...cache.data };
    }
    const data = await loadFromDisk(path);
    cache = { path, mtime, data };
    return { ...data };
  } catch {
    return loadFromDisk(path);
  }
}

async function writeFile(path: string, data: BindingFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, path);
  cache = null;
}

export async function getBinding(
  path: string,
  openId: string,
): Promise<LarkBinding | null> {
  const data = await loadBindings(path);
  return data[openId] ?? null;
}

export async function setBinding(
  path: string,
  openId: string,
  binding: LarkBinding,
): Promise<void> {
  const data = await loadBindings(path);
  data[openId] = binding;
  await writeFile(path, data);
}

export async function removeBinding(
  path: string,
  openId: string,
): Promise<void> {
  const data = await loadBindings(path);
  if (!(openId in data)) return;
  delete data[openId];
  await writeFile(path, data);
}

export async function updateBinding(
  path: string,
  openId: string,
  patch: Partial<LarkBinding>,
): Promise<LarkBinding | null> {
  const data = await loadBindings(path);
  const current = data[openId];
  if (!current) return null;
  const next = { ...current, ...patch };
  data[openId] = next;
  await writeFile(path, data);
  return next;
}
