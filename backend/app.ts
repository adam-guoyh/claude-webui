/**
 * Runtime-agnostic Hono application
 *
 * This module creates the Hono application with all routes and middleware,
 * but doesn't include runtime-specific code like CLI parsing or server startup.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Runtime } from "./runtime/types.ts";
import {
  type ConfigContext,
  createConfigMiddleware,
} from "./middleware/config.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { issueSession, revokeSession } from "./auth/sessionStore.ts";
import { verifyCredentials } from "./auth/userStore.ts";
import { handleProjectsRequest } from "./handlers/projects.ts";
import {
  handleHistoriesRequest,
  handleSetSessionTitleRequest,
} from "./handlers/histories.ts";
import { handleConversationRequest } from "./handlers/conversations.ts";
import { handleChatRequest } from "./handlers/chat.ts";
import { handleAbortRequest } from "./handlers/abort.ts";
import { logger } from "./utils/logger.ts";
import { readBinaryFile } from "./utils/fs.ts";

export interface AppConfig {
  debugMode: boolean;
  staticPath: string;
  cliPath: string; // Actual CLI script path detected by validateClaudeCli
  authToken?: string;
  usersFile?: string;
}

export function createApp(
  runtime: Runtime,
  config: AppConfig,
): Hono<ConfigContext> {
  const app = new Hono<ConfigContext>();

  // Store AbortControllers for each request (shared with chat handler)
  const requestAbortControllers = new Map<string, AbortController>();

  // CORS middleware
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Configuration middleware - makes app settings available to all handlers
  app.use(
    "*",
    createConfigMiddleware({
      debugMode: config.debugMode,
      runtime,
      cliPath: config.cliPath,
    }),
  );

  // Auth middleware - gates /api/* (no-op when no token configured).
  // /api/auth/status and /api/auth/login are exempt inside the middleware so
  // the frontend can discover auth requirements and sign in without yet
  // holding a token.
  app.use(
    "/api/*",
    createAuthMiddleware({
      authToken: config.authToken,
      usersFile: config.usersFile,
    }),
  );

  // Public auth-status endpoint: tells the frontend whether the server
  // requires auth and whether multi-user (username+password) is enabled.
  // Never reveals the token or any user data.
  app.get("/api/auth/status", (c) =>
    c.json({
      authRequired: Boolean(config.authToken || config.usersFile),
      multiUser: Boolean(config.usersFile),
    }),
  );

  // Multi-user login: exchanges username+password for an opaque session token.
  // Only exposed when a users file is configured.
  app.post("/api/auth/login", async (c) => {
    if (!config.usersFile) {
      return c.json({ error: "Login not available" }, 404);
    }
    let body: { username?: unknown; password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const ok = await verifyCredentials(config.usersFile, username, password);
    if (!ok) {
      return c.json({ error: "Invalid username or password" }, 401);
    }
    const token = issueSession(username);
    return c.json({ token, username });
  });

  // Logout: revoke the bearer in the Authorization header (if any). Idempotent.
  app.post("/api/auth/logout", (c) => {
    const header = c.req.header("Authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (m) revokeSession(m[1].trim());
    return c.json({ ok: true });
  });

  // Gated lightweight check: succeeds (200) only when the caller is
  // authenticated (or auth is disabled). Used by the login flow to verify a
  // token before transitioning into the app.
  app.get("/api/auth/check", (c) =>
    c.json({ ok: true, user: c.var.authUser ?? null }),
  );

  // API routes
  app.get("/api/projects", (c) => handleProjectsRequest(c));

  app.get("/api/projects/:encodedProjectName/histories", (c) =>
    handleHistoriesRequest(c),
  );

  app.get("/api/projects/:encodedProjectName/histories/:sessionId", (c) =>
    handleConversationRequest(c),
  );

  app.put("/api/projects/:encodedProjectName/sessions/:sessionId/title", (c) =>
    handleSetSessionTitleRequest(c),
  );

  app.post("/api/abort/:requestId", (c) =>
    handleAbortRequest(c, requestAbortControllers),
  );

  app.post("/api/chat", (c) => handleChatRequest(c, requestAbortControllers));

  // Static file serving with SPA fallback
  // Serve static assets (CSS, JS, images, etc.)
  const serveStatic = runtime.createStaticFileMiddleware({
    root: config.staticPath,
  });
  app.use("/assets/*", serveStatic);

  // SPA fallback - serve index.html for all unmatched routes (except API routes)
  app.get("*", async (c) => {
    const path = c.req.path;

    // Skip API routes
    if (path.startsWith("/api/")) {
      return c.text("Not found", 404);
    }

    try {
      const indexPath = `${config.staticPath}/index.html`;
      const indexFile = await readBinaryFile(indexPath);
      return c.html(new TextDecoder().decode(indexFile));
    } catch (error) {
      logger.app.error("Error serving index.html: {error}", { error });
      return c.text("Internal server error", 500);
    }
  });

  return app;
}
