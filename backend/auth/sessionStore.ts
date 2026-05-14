/**
 * In-memory session token store.
 *
 * Tokens are opaque 32-byte base64 strings issued by /api/auth/login.
 * They map back to a username and an expiry timestamp. Server restart
 * invalidates everyone — acceptable for a local/LAN tool, and avoids the
 * complexity of signing or persisting credentials.
 */

import { randomBytes } from "node:crypto";

interface SessionRecord {
  username: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const sessions = new Map<string, SessionRecord>();

export function issueSession(username: string, ttlMs = DEFAULT_TTL_MS): string {
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { username, expiresAt: Date.now() + ttlMs });
  return token;
}

export function resolveSession(token: string): string | null {
  const record = sessions.get(token);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return record.username;
}

export function revokeSession(token: string): void {
  sessions.delete(token);
}
