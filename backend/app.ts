/**
 * Runtime-agnostic Hono application
 *
 * This module creates the Hono application with all routes and middleware,
 * but doesn't include runtime-specific code like CLI parsing or server startup.
 */

import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { Runtime } from "./runtime/types.ts";
import {
  type ConfigContext,
  createConfigMiddleware,
} from "./middleware/config.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { issueSession, revokeSession } from "./auth/sessionStore.ts";
import {
  UserMgmtError,
  addUser,
  getUserRole,
  listUsers,
  removeUser,
  resetPassword,
  verifyCredentials,
  type UserRole,
} from "./auth/userStore.ts";

type UserRoleCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; error: string };
import {
  handleCreateProjectRequest,
  handleDeleteProjectRequest,
  handleProjectsRequest,
} from "./handlers/projects.ts";
import { handleBrowseRequest } from "./handlers/browse.ts";
import {
  handleDeleteSessionRequest,
  handleHistoriesRequest,
  handleSetSessionOwnerRequest,
  handleSetSessionTitleRequest,
} from "./handlers/histories.ts";
import { handleConversationRequest } from "./handlers/conversations.ts";
import { handleChatRequest } from "./handlers/chat.ts";
import { handleAbortRequest } from "./handlers/abort.ts";
import {
  handleAddLarkApp,
  handleGetLarkSettings,
  handleIssueLinkCode,
  handleListIntegrations,
  handleListLarkApps,
  handlePutLarkSettings,
  handleRemoveBinding,
  handleRemoveLarkApp,
  type IntegrationsDeps,
} from "./handlers/integrations.ts";
import { logger } from "./utils/logger.ts";
import { readBinaryFile } from "./utils/fs.ts";

export interface AppConfig {
  debugMode: boolean;
  staticPath: string;
  cliPath: string; // Actual CLI script path detected by validateClaudeCli
  authToken?: string;
  usersFile?: string;
  /** Optional — present when at least one IM provider is configured. */
  integrations?: IntegrationsDeps;
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
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
      usersFile: config.usersFile,
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
  app.get("/api/auth/check", async (c) => {
    const user = c.var.authUser;
    const role =
      user && config.usersFile
        ? await getUserRole(config.usersFile, user)
        : null;
    return c.json({ ok: true, user, role });
  });

  // Translate a UserMgmtError into a JSON response so each endpoint can stay
  // focused on the happy path.
  const mgmtError = (c: Context<ConfigContext>, err: unknown) => {
    if (err instanceof UserMgmtError) {
      const status =
        err.code === "exists"
          ? 409
          : err.code === "not-found"
            ? 404
            : err.code === "last-admin"
              ? 400
              : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    logger.app.error("User management error: {error}", { error: err });
    return c.json({ error: "Internal error" }, 500);
  };

  // ─── User management (admin only) ────────────────────────────────────────
  //
  // These endpoints are no-ops when multi-user mode isn't enabled (404), and
  // require an admin caller otherwise. They never reveal password hashes.

  const requireAdmin = async (user: string | null): Promise<UserRoleCheck> => {
    if (!config.usersFile)
      return { ok: false, status: 404, error: "Multi-user not enabled" };
    if (!user) return { ok: false, status: 401, error: "Unauthorized" };
    const role = await getUserRole(config.usersFile, user);
    if (role !== "admin")
      return { ok: false, status: 403, error: "Admin only" };
    return { ok: true };
  };

  app.get("/api/users", async (c) => {
    const check = await requireAdmin(c.var.authUser);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    const users = await listUsers(config.usersFile!);
    return c.json({ users });
  });

  app.post("/api/users", async (c) => {
    const check = await requireAdmin(c.var.authUser);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    let body: { username?: unknown; password?: unknown; role?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role: UserRole = body.role === "admin" ? "admin" : "user";
    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }
    try {
      const user = await addUser(config.usersFile!, username, password, role);
      return c.json({ user }, 201);
    } catch (err) {
      return mgmtError(c, err);
    }
  });

  app.delete("/api/users/:username", async (c) => {
    const check = await requireAdmin(c.var.authUser);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    const target = c.req.param("username");
    if (target === c.var.authUser) {
      return c.json({ error: "You cannot remove your own account" }, 400);
    }
    try {
      await removeUser(config.usersFile!, target);
      return c.json({ ok: true });
    } catch (err) {
      return mgmtError(c, err);
    }
  });

  app.put("/api/users/:username/password", async (c) => {
    // Admins can reset anyone's password. Regular users can reset only their
    // own (and only when the request body provides the new password). We don't
    // require the old password for admin resets; for self-resets we don't
    // either since the session token already proves identity.
    if (!config.usersFile) return c.json({ error: "Not available" }, 404);
    const caller = c.var.authUser;
    if (!caller) return c.json({ error: "Unauthorized" }, 401);
    const target = c.req.param("username");
    if (target !== caller) {
      const adminCheck = await requireAdmin(caller);
      if (!adminCheck.ok)
        return c.json({ error: adminCheck.error }, adminCheck.status);
    }
    let body: { password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return c.json({ error: "Password is required" }, 400);
    try {
      await resetPassword(config.usersFile, target, password);
      return c.json({ ok: true });
    } catch (err) {
      return mgmtError(c, err);
    }
  });

  // API routes
  app.get("/api/projects", (c) => handleProjectsRequest(c));
  app.post("/api/projects", (c) => handleCreateProjectRequest(c));
  app.delete("/api/projects/:encodedProjectName", (c) =>
    handleDeleteProjectRequest(c),
  );
  app.get("/api/fs/browse", (c) => handleBrowseRequest(c));

  app.get("/api/projects/:encodedProjectName/histories", (c) =>
    handleHistoriesRequest(c),
  );

  app.get("/api/projects/:encodedProjectName/histories/:sessionId", (c) =>
    handleConversationRequest(c),
  );

  app.put("/api/projects/:encodedProjectName/sessions/:sessionId/title", (c) =>
    handleSetSessionTitleRequest(c),
  );

  app.put("/api/projects/:encodedProjectName/sessions/:sessionId/owner", (c) =>
    handleSetSessionOwnerRequest(c),
  );

  app.delete("/api/projects/:encodedProjectName/sessions/:sessionId", (c) =>
    handleDeleteSessionRequest(c),
  );

  app.post("/api/abort/:requestId", (c) =>
    handleAbortRequest(c, requestAbortControllers),
  );

  app.post("/api/chat", (c) => handleChatRequest(c, requestAbortControllers));

  // Integrations (IM account ↔ webui user). Only mounted in multi-user mode
  // since each binding has to belong to a real user; without a users file
  // there is no "self" to bind. Returns 404 otherwise.
  if (config.integrations && config.usersFile) {
    const deps = config.integrations;
    const requireAdminGate = async (
      c: Context<ConfigContext>,
    ): Promise<Response | null> => {
      const check = await requireAdmin(c.var.authUser);
      if (!check.ok) return c.json({ error: check.error }, check.status);
      return null;
    };

    app.get("/api/integrations", (c) => handleListIntegrations(c, deps));
    app.post("/api/integrations/:provider/code", (c) =>
      handleIssueLinkCode(c, deps),
    );
    app.delete("/api/integrations/:provider/bindings/:externalId", (c) =>
      handleRemoveBinding(c, deps),
    );

    // Lark provider app management. The handlers themselves enforce
    // role-based access:
    //  - admins / open mode: full CRUD over any app
    //  - users: read all + manage their own apps, gated by the
    //    `allowUserApps` setting
    app.get("/api/integrations/lark/apps", (c) => handleListLarkApps(c, deps));
    app.post("/api/integrations/lark/apps", (c) => handleAddLarkApp(c, deps));
    app.delete("/api/integrations/lark/apps/:id", (c) =>
      handleRemoveLarkApp(c, deps),
    );
    // Settings: read is open to authenticated callers (UI uses it to know
    // whether to show the management form); write is admin only.
    app.get("/api/integrations/lark/settings", (c) =>
      handleGetLarkSettings(c, deps),
    );
    app.put("/api/integrations/lark/settings", async (c) => {
      const block = await requireAdminGate(c);
      if (block) return block;
      return handlePutLarkSettings(c, deps);
    });
  } else {
    app.get("/api/integrations", (c) =>
      c.json({ error: "Integrations not available" }, 404),
    );
  }

  // Static file serving with SPA fallback.
  // In dev mode the frontend is served by Vite on a separate port, so the
  // backend's static dir doesn't exist yet — register the middleware only
  // when it does, otherwise @hono/node-server's serveStatic logs a noisy
  // "root path … is not found" warning on every request.
  if (existsSync(config.staticPath)) {
    const serveStatic = runtime.createStaticFileMiddleware({
      root: config.staticPath,
    });
    app.use("/assets/*", serveStatic);

    // SPA fallback - serve index.html for all unmatched routes (except API).
    app.get("*", async (c) => {
      const path = c.req.path;
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
  } else {
    logger.app.debug(
      "Static path {path} does not exist — skipping SPA hosting (dev mode?)",
      { path: config.staticPath },
    );
    // Non-API requests in dev hit Vite directly on :3000, not us. Return a
    // helpful 404 here in case someone curls the backend by mistake.
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
      return c.text(
        "Backend is running but no static bundle is mounted (dev mode). Open the Vite dev server instead.",
        404,
      );
    });
  }

  return app;
}
