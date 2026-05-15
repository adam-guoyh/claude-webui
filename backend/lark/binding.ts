/**
 * Persisted Feishu open_id ↔ webui username binding.
 *
 * Stored at `~/.claude-webui/lark-bindings.json`. Bindings are nested by
 * appId so a single backend can host multiple Feishu apps without their
 * bindings colliding (two different tenants can both have open_id "ou_abc"
 * pointing at different users).
 *
 * On-disk format:
 *     { "<appId>": { "<openId>": { username, cwd, sessionId? } } }
 *
 * A legacy flat format (`{ "<openId>": {...} }`) is still readable for
 * single-app installs that pre-date multi-app support — it gets surfaced
 * under an empty-appId bucket and migrated lazily on first read.
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

export interface BindingFile {
  [appId: string]: { [openId: string]: LarkBinding };
}

export function defaultBindingPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "lark-bindings.json");
}

let cache: { path: string; mtime: number; data: BindingFile } | null = null;

function isBindingValue(v: unknown): v is LarkBinding {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.username === "string" && typeof rec.cwd === "string";
}

async function loadFromDisk(path: string): Promise<BindingFile> {
  if (!(await exists(path))) return {};
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    // Detect legacy flat format by checking whether the top-level values
    // already look like bindings rather than nested maps.
    const values = Object.values(obj);
    const legacy = values.length > 0 && values.every(isBindingValue);
    if (legacy) {
      const out: BindingFile = { "": {} };
      for (const [openId, v] of Object.entries(obj)) {
        if (!isBindingValue(v)) continue;
        out[""][openId] = {
          username: v.username,
          cwd: v.cwd,
          sessionId: v.sessionId,
        };
      }
      return out;
    }
    const out: BindingFile = {};
    for (const [appId, inner] of Object.entries(obj)) {
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) continue;
      out[appId] = {};
      for (const [openId, v] of Object.entries(
        inner as Record<string, unknown>,
      )) {
        if (!isBindingValue(v)) continue;
        out[appId][openId] = {
          username: v.username,
          cwd: v.cwd,
          sessionId: v.sessionId,
        };
      }
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
      return structuredClone(cache.data);
    }
    const data = await loadFromDisk(path);
    cache = { path, mtime, data };
    return structuredClone(data);
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

/**
 * Look up a binding for a specific (appId, openId). Also consults the
 * legacy empty-appId bucket and lazily migrates an entry the first time
 * it's seen — so a single-app install upgrading to multi-app preserves
 * existing bindings without operator intervention.
 */
export async function getBinding(
  path: string,
  appId: string,
  openId: string,
): Promise<LarkBinding | null> {
  const data = await loadBindings(path);
  const direct = data[appId]?.[openId];
  if (direct) return direct;
  const legacy = data[""]?.[openId];
  if (legacy) {
    if (!data[appId]) data[appId] = {};
    data[appId][openId] = legacy;
    delete data[""][openId];
    if (Object.keys(data[""]).length === 0) delete data[""];
    await writeFile(path, data);
    return legacy;
  }
  return null;
}

export async function setBinding(
  path: string,
  appId: string,
  openId: string,
  binding: LarkBinding,
): Promise<void> {
  const data = await loadBindings(path);
  if (!data[appId]) data[appId] = {};
  data[appId][openId] = binding;
  await writeFile(path, data);
}

export async function removeBinding(
  path: string,
  appId: string,
  openId: string,
): Promise<void> {
  const data = await loadBindings(path);
  let changed = false;
  if (data[appId]?.[openId]) {
    delete data[appId][openId];
    if (Object.keys(data[appId]).length === 0) delete data[appId];
    changed = true;
  }
  if (data[""]?.[openId]) {
    delete data[""][openId];
    if (Object.keys(data[""]).length === 0) delete data[""];
    changed = true;
  }
  if (changed) await writeFile(path, data);
}

export async function updateBinding(
  path: string,
  appId: string,
  openId: string,
  patch: Partial<LarkBinding>,
): Promise<LarkBinding | null> {
  const data = await loadBindings(path);
  const current = data[appId]?.[openId] ?? data[""]?.[openId];
  if (!current) return null;
  const next = { ...current, ...patch };
  if (!data[appId]) data[appId] = {};
  data[appId][openId] = next;
  if (data[""]?.[openId]) {
    delete data[""][openId];
    if (Object.keys(data[""]).length === 0) delete data[""];
  }
  await writeFile(path, data);
  return next;
}
