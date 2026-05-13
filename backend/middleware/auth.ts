import { createMiddleware } from "hono/factory";

/**
 * Creates bearer-token auth middleware for /api/* routes.
 *
 * When no token is configured the middleware is a no-op, preserving the
 * original "no auth" behavior for local-only deployments.
 *
 * When a token is configured:
 * - GET /api/auth/status is exempt (used by the frontend to discover whether
 *   auth is required and the user should be sent to the login screen)
 * - All other /api/* requests must include `Authorization: Bearer <token>`;
 *   otherwise the middleware short-circuits with 401.
 */
export function createAuthMiddleware(authToken?: string) {
  return createMiddleware(async (c, next) => {
    if (!authToken) {
      await next();
      return;
    }

    if (c.req.path === "/api/auth/status") {
      await next();
      return;
    }

    const header = c.req.header("Authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match?.[1]?.trim();

    if (!provided || !timingSafeEqual(provided, authToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
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
