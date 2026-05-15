/**
 * Single-use, short-lived link codes used to pair an IM account (Feishu /
 * WeChat / QQ / …) with a webui user without an OAuth callback URL.
 *
 * Flow:
 *  1. The webui user, while signed in, asks the backend for a code via
 *     `POST /api/integrations/:provider/code`. Returns `{ code, expiresAt }`.
 *  2. The user opens the IM app and DMs the bot `/link <code>`.
 *  3. The bot calls `consumeCode(code, provider)` to atomically retrieve the
 *     webui username, then persists the binding under the user's IM id.
 *
 * Codes are kept in-memory only — restart invalidates them, which is fine for
 * a 10-minute TTL flow.
 */

import { randomBytes } from "node:crypto";

interface CodeEntry {
  code: string;
  username: string;
  provider: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
/**
 * 6-char alphanumeric code, omitting visually-ambiguous chars (0/O/1/I/L).
 * Entropy ~30 bits — fine for a 10-minute window with rate-limited typing
 * into a chat client.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export class LinkCodeStore {
  private readonly codes = new Map<string, CodeEntry>();

  /**
   * Mint a new code for the given user+provider, replacing any prior code
   * the same user holds for that provider so a user can't accidentally
   * exhaust their own slots.
   */
  issue(username: string, provider: string): CodeEntry {
    this.gc();
    for (const [c, entry] of this.codes) {
      if (entry.username === username && entry.provider === provider) {
        this.codes.delete(c);
      }
    }
    let code = generateCode();
    while (this.codes.has(code)) code = generateCode();
    const entry: CodeEntry = {
      code,
      username,
      provider,
      expiresAt: Date.now() + TTL_MS,
    };
    this.codes.set(code, entry);
    return entry;
  }

  /**
   * Atomically consume a code. Returns the resolved username on success, or
   * null if the code is unknown, expired, or for a different provider.
   */
  consume(code: string, provider: string): string | null {
    this.gc();
    const normalized = code.trim().toUpperCase();
    const entry = this.codes.get(normalized);
    if (!entry) return null;
    if (entry.provider !== provider) return null;
    if (entry.expiresAt < Date.now()) {
      this.codes.delete(normalized);
      return null;
    }
    this.codes.delete(normalized);
    return entry.username;
  }

  /** TTL for clients — exposed so the API can echo it back. */
  ttlMs(): number {
    return TTL_MS;
  }

  private gc(): void {
    const now = Date.now();
    for (const [c, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(c);
    }
  }
}
