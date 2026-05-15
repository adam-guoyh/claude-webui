/**
 * File-backed user store.
 *
 * Reads JSON of the form:
 *   {
 *     "users": [
 *       { "username": "alice", "passwordHash": "scrypt$...", "role": "admin" | "user" }
 *     ]
 *   }
 *
 * Password hashing uses Node's built-in `crypto.scrypt` so we don't pull in a
 * native dep (bcrypt) just for this. Format: `scrypt$<N>$<r>$<p>$<salt>$<hash>`,
 * all base64-url encoded — opaque to callers, verifiable in constant time.
 *
 * Loading is lazy + cached with mtime invalidation so admins can edit the file
 * while the server is running and changes take effect on next auth attempt.
 */

import { promises as fs } from "node:fs";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { exists, readTextFile, stat } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

// Default scrypt parameters (N=2**15, r=8) consume 128·N·r ≈ 32 MiB which
// is exactly Node's default `maxmem`. We raise the ceiling so scrypt
// doesn't bounce off the limit; the cost stays the same.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export type UserRole = "admin" | "user";

export interface UserPermissions {
  /**
   * Whether the user may add/remove their own Feishu / Lark app configs from
   * the Integrations page. Admins always can; for regular users this is an
   * explicit admin-granted privilege (default false). Absent in the file =
   * false.
   */
  canManageLarkApps?: boolean;
}

export interface StoredUser {
  username: string;
  passwordHash: string;
  role: UserRole;
  permissions?: UserPermissions;
}

interface UserFile {
  users: StoredUser[];
}

/** Public-safe view, never includes the password hash. */
export interface PublicUser {
  username: string;
  role: UserRole;
  permissions: UserPermissions;
}

let cache: { path: string; mtime: number; users: StoredUser[] } | null = null;

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export async function hashPassword(password: string): Promise<string> {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${N}$${r}$${p}$${b64url(salt)}$${b64url(derived)}`;
}

async function verifyHash(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const salt = fromB64url(parts[4]);
  const expected = fromB64url(parts[5]);
  try {
    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch (e) {
    logger.cli.debug("scrypt verify error: {error}", { error: e });
    return false;
  }
}

function normalizePermissions(raw: unknown): UserPermissions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const out: UserPermissions = {};
  if (typeof p.canManageLarkApps === "boolean") {
    out.canManageLarkApps = p.canManageLarkApps;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeUser(raw: unknown): StoredUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.username !== "string") return null;
  if (typeof u.passwordHash !== "string") return null;
  const role: UserRole = u.role === "admin" ? "admin" : "user";
  const permissions = normalizePermissions(u.permissions);
  return {
    username: u.username,
    passwordHash: u.passwordHash,
    role,
    ...(permissions ? { permissions } : {}),
  };
}

async function loadFromDisk(path: string): Promise<StoredUser[]> {
  if (!(await exists(path))) return [];
  const raw = await readTextFile(path);
  const parsed = JSON.parse(raw) as UserFile | StoredUser[];
  const list = Array.isArray(parsed) ? parsed : (parsed?.users ?? []);
  if (!Array.isArray(list)) return [];
  const result: StoredUser[] = [];
  for (const item of list) {
    const u = normalizeUser(item);
    if (u) result.push(u);
  }
  return result;
}

async function getUsers(path: string): Promise<StoredUser[]> {
  try {
    const info = await stat(path);
    const mtime = info.mtime?.getTime() ?? 0;
    if (cache && cache.path === path && cache.mtime === mtime) {
      return cache.users;
    }
    const users = await loadFromDisk(path);
    cache = { path, mtime, users };
    return users;
  } catch (error) {
    logger.cli.warn("Failed to read users file {path}: {error}", {
      path,
      error,
    });
    return [];
  }
}

export async function userCount(path: string): Promise<number> {
  return (await getUsers(path)).length;
}

export async function listUsers(path: string): Promise<PublicUser[]> {
  return (await getUsers(path)).map((u) => ({
    username: u.username,
    role: u.role,
    permissions: u.permissions ?? {},
  }));
}

/**
 * Look up a single permission for the given user. Returns `false` when the
 * user doesn't exist or the file is unreadable — fail closed.
 */
export async function getUserPermission(
  path: string,
  username: string,
  key: keyof UserPermissions,
): Promise<boolean> {
  const users = await getUsers(path);
  const user = users.find((u) => u.username === username);
  if (!user || !user.permissions) return false;
  return user.permissions[key] === true;
}

export async function setUserPermissions(
  path: string,
  username: string,
  patch: Partial<UserPermissions>,
): Promise<UserPermissions> {
  const users = await readUserFile(path);
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    throw new UserMgmtError("not-found", `User ${username} not found`);
  }
  const current = users[idx].permissions ?? {};
  const next: UserPermissions = { ...current };
  if ("canManageLarkApps" in patch) {
    if (patch.canManageLarkApps === true) next.canManageLarkApps = true;
    else delete next.canManageLarkApps;
  }
  users[idx] = {
    ...users[idx],
    ...(Object.keys(next).length > 0 ? { permissions: next } : {}),
  };
  // When no flags remain, drop the `permissions` key entirely to keep the
  // file tidy.
  if (Object.keys(next).length === 0) {
    delete (users[idx] as { permissions?: UserPermissions }).permissions;
  }
  await writeUserFile(path, users);
  return next;
}

export async function getUserRole(
  path: string,
  username: string,
): Promise<UserRole | null> {
  const users = await getUsers(path);
  const user = users.find((u) => u.username === username);
  return user ? user.role : null;
}

/**
 * Verify a username+password pair against the configured users file.
 * Always runs a scrypt computation (even on unknown usernames) so attackers
 * can't distinguish "no such user" from "wrong password" by timing.
 */
export async function verifyCredentials(
  path: string,
  username: string,
  password: string,
): Promise<boolean> {
  const users = await getUsers(path);
  const user = users.find((u) => u.username === username);
  if (!user) {
    const dummy = await hashPassword("__dummy__");
    await verifyHash(password, dummy);
    return false;
  }
  return await verifyHash(password, user.passwordHash);
}

export async function writeUserFile(
  path: string,
  users: StoredUser[],
): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify({ users }, null, 2));
  await fs.rename(tmp, path);
  cache = null;
}

/** Read users from disk, bypassing the cache. Used by mutating helpers. */
export async function readUserFile(path: string): Promise<StoredUser[]> {
  return loadFromDisk(path);
}

export class UserMgmtError extends Error {
  constructor(
    public code:
      | "exists"
      | "not-found"
      | "last-admin"
      | "invalid-role"
      | "invalid-input",
    message: string,
  ) {
    super(message);
  }
}

/** Add a new user. Throws UserMgmtError("exists") if the username is taken. */
export async function addUser(
  path: string,
  username: string,
  password: string,
  role: UserRole = "user",
): Promise<PublicUser> {
  if (!username.trim() || !password) {
    throw new UserMgmtError(
      "invalid-input",
      "Username and password are required",
    );
  }
  if (role !== "admin" && role !== "user") {
    throw new UserMgmtError("invalid-role", `Unknown role ${role}`);
  }
  const users = await readUserFile(path);
  if (users.some((u) => u.username === username)) {
    throw new UserMgmtError("exists", `User ${username} already exists`);
  }
  const passwordHash = await hashPassword(password);
  users.push({ username, passwordHash, role });
  await writeUserFile(path, users);
  return { username, role, permissions: {} };
}

/**
 * Remove a user. Refuses to remove the last admin so the system can't lock
 * itself out.
 */
export async function removeUser(
  path: string,
  username: string,
): Promise<void> {
  const users = await readUserFile(path);
  const target = users.find((u) => u.username === username);
  if (!target) {
    throw new UserMgmtError("not-found", `User ${username} not found`);
  }
  if (target.role === "admin") {
    const adminCount = users.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) {
      throw new UserMgmtError(
        "last-admin",
        "Refusing to remove the last admin",
      );
    }
  }
  await writeUserFile(
    path,
    users.filter((u) => u.username !== username),
  );
}

/** Reset a user's password. */
export async function resetPassword(
  path: string,
  username: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword) {
    throw new UserMgmtError("invalid-input", "Password is required");
  }
  const users = await readUserFile(path);
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    throw new UserMgmtError("not-found", `User ${username} not found`);
  }
  users[idx] = { ...users[idx], passwordHash: await hashPassword(newPassword) };
  await writeUserFile(path, users);
}

/**
 * Idempotently ensure the configured admin exists. If the users file has no
 * admin, create one using the provided credentials. Returns true when a new
 * admin was created so the caller can log/print the password.
 */
export async function ensureAdminUser(
  path: string,
  username: string,
  password: string,
): Promise<boolean> {
  const users = await readUserFile(path);
  const hasAdmin = users.some((u) => u.role === "admin");
  if (hasAdmin) return false;

  const existingIdx = users.findIndex((u) => u.username === username);
  const passwordHash = await hashPassword(password);
  if (existingIdx === -1) {
    users.push({ username, passwordHash, role: "admin" });
  } else {
    // Username collides with an existing non-admin entry — promote and reset.
    users[existingIdx] = { username, passwordHash, role: "admin" };
  }
  await writeUserFile(path, users);
  return true;
}
