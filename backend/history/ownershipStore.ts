/**
 * Per-project store of session ownership.
 *
 * Records which user owns each Claude session so we can scope the sidebar,
 * delete, and rename actions per-user. Stored at
 *   ~/.claude/projects/<encodedProjectName>/.webui-ownership.json
 * keyed by sessionId.
 *
 * Sessions created before this feature existed have no recorded owner and
 * surface as "unowned" — visible to admins only, who can assign them via the
 * move endpoint.
 *
 * Single-user-host model: no locking; writes are tmp+rename for crash-safety.
 * Read errors degrade silently to an empty map so a broken JSON blob can't
 * take down the histories endpoint.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { exists, readTextFile, writeTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import { logger } from "../utils/logger.ts";

const OWNERSHIP_FILE = ".webui-ownership.json";

export type OwnershipMap = Record<string, string>;

function projectDir(encodedProjectName: string): string {
  const homeDir = getHomeDir();
  if (!homeDir) throw new Error("Home directory not found");
  return join(homeDir, ".claude", "projects", encodedProjectName);
}

function ownershipPath(encodedProjectName: string): string {
  return join(projectDir(encodedProjectName), OWNERSHIP_FILE);
}

export async function loadOwners(
  encodedProjectName: string,
): Promise<OwnershipMap> {
  const path = ownershipPath(encodedProjectName);
  try {
    if (!(await exists(path))) return {};
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: OwnershipMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch (error) {
    logger.history.warn(
      "Failed to read ownership store for {project}: {error}",
      { project: encodedProjectName, error },
    );
    return {};
  }
}

async function writeOwners(
  encodedProjectName: string,
  owners: OwnershipMap,
): Promise<void> {
  const path = ownershipPath(encodedProjectName);
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await writeTextFile(tmp, JSON.stringify(owners, null, 2));
  await fs.rename(tmp, path);
}

export async function getOwner(
  encodedProjectName: string,
  sessionId: string,
): Promise<string | null> {
  const owners = await loadOwners(encodedProjectName);
  return owners[sessionId] ?? null;
}

/**
 * Record ownership for a session. Idempotent — re-calling with the same
 * username is a no-op, so the chat handler can call this on every assistant
 * response without thrashing the disk.
 */
export async function setOwner(
  encodedProjectName: string,
  sessionId: string,
  username: string,
): Promise<void> {
  if (!username) return;
  const owners = await loadOwners(encodedProjectName);
  if (owners[sessionId] === username) return;
  owners[sessionId] = username;
  await writeOwners(encodedProjectName, owners);
}

export async function removeOwner(
  encodedProjectName: string,
  sessionId: string,
): Promise<void> {
  const owners = await loadOwners(encodedProjectName);
  if (!(sessionId in owners)) return;
  delete owners[sessionId];
  await writeOwners(encodedProjectName, owners);
}
