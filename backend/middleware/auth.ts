import { createMiddleware } from "hono/factory";
import { resolveSession } from "../auth/sessionStore.ts";

export interface AuthOptions {
  /** Shared bearer token (single-user mode). Mutually compatible with usersFile. */
  authToken?: string;
  /** Path to users.json (multi-user mode). When set, login endpoint is exposed. */
  usersFile?: string;
}

/**
 * Auth middleware variables exposed to downstream handlers via `c.var`.
 */
export interface AuthVariables {
  /**
   * Username of the authenticated caller. `null` when auth is disabled (open
   * mode) or when the caller authenticated with the legacy shared token —
   * neither has a real identity.
   */
  authUser: string | null;
}

const PUBLIC_PATHS = new Set(["/api/auth/status", "/api/auth/login"]);

/**
 * Creates auth middleware for /api/* routes. Supports two parallel modes
 * which can coexist:
 *
 * - Shared bearer token (legacy): Authorization header must equal authToken.
 *   Backward-compat with the original `--auth-token` flag. The caller has
 *   no identity (`c.var.authUser === null`).
 *
 * - Multi-user with users.json: Authorization is a session token previously
 *   issued by POST /api/auth/login. The caller's username is exposed as
 *   `c.var.authUser`.
 *
 * When neither is configured the middleware is a no-op (open mode).
 *
 * Exempt paths: /api/auth/status (anyone can discover whether auth is
 * required) and /api/auth/login (so unauthenticated users can sign in).
 */
export function createAuthMiddleware(options: AuthOptions) {
  const { authToken, usersFile } = options;
  const requireAuth = Boolean(authToken) || Boolean(usersFile);

  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    if (!requireAuth) {
      c.set("authUser", null);
      await next();
      return;
    }

    if (PUBLIC_PATHS.has(c.req.path)) {
      c.set("authUser", null);
      await next();
      return;
    }

    const header = c.req.header("Authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match?.[1]?.trim();

    if (!provided) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // First, try the legacy shared token. It has no associated user.
    if (authToken && timingSafeEqual(provided, authToken)) {
      c.set("authUser", null);
      await next();
      return;
    }

    // Then, try as a session token issued via /api/auth/login.
    if (usersFile) {
      const username = resolveSession(provided);
      if (username) {
        c.set("authUser", username);
        await next();
        return;
      }
    }

    return c.json({ error: "Unauthorized" }, 401);
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
