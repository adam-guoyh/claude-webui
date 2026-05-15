/**
 * Persisted Lark integration settings. Currently just a single toggle
 * (`allowUserApps`) controlling whether non-admin webui users can register
 * their own Feishu app credentials from the Integrations page.
 *
 * Lives at `~/.claude-webui/lark-settings.json`. Defaults: everything off
 * so a fresh install behaves like the admin-only model.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { exists, readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

export interface LarkSettings {
  allowUserApps: boolean;
}

const DEFAULTS: LarkSettings = { allowUserApps: false };

export function defaultSettingsPath(): string {
  const home = getHomeDir();
  if (!home) throw new Error("Home directory not found");
  return join(home, ".claude-webui", "lark-settings.json");
}

export async function loadSettings(path: string): Promise<LarkSettings> {
  if (!(await exists(path))) return { ...DEFAULTS };
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
    const rec = parsed as Record<string, unknown>;
    return {
      allowUserApps:
        typeof rec.allowUserApps === "boolean" ? rec.allowUserApps : false,
    };
  } catch (error) {
    logger.cli.warn("Failed to read lark-settings: {error}", { error });
    return { ...DEFAULTS };
  }
}

export async function saveSettings(
  path: string,
  settings: LarkSettings,
): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}
