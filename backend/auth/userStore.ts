/**
 * File-backed user store.
 *
 * Reads JSON of the form:
 *   { "users": [ { "username": "alice", "passwordHash": "scrypt$N$r$p$salt$hash" }, ... ] }
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

interface StoredUser {
  username: string;
  passwordHash: string;
}

interface UserFile {
  users: StoredUser[];
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
  const derived = await scrypt(password, salt, 64, { N, r, p });
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
    const derived = await scrypt(password, salt, expected.length, { N, r, p });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch (e) {
    logger.cli.debug("scrypt verify error: {error}", { error: e });
    return false;
  }
}

async function loadFromDisk(path: string): Promise<StoredUser[]> {
  if (!(await exists(path))) return [];
  const raw = await readTextFile(path);
  const parsed = JSON.parse(raw) as UserFile | StoredUser[];
  const users = Array.isArray(parsed) ? parsed : (parsed?.users ?? []);
  if (!Array.isArray(users)) return [];
  return users.filter(
    (u): u is StoredUser =>
      typeof u === "object" &&
      u !== null &&
      typeof (u as StoredUser).username === "string" &&
      typeof (u as StoredUser).passwordHash === "string",
  );
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

export async function readUserFile(path: string): Promise<StoredUser[]> {
  return loadFromDisk(path);
}
