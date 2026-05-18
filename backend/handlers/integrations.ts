/**
 * HTTP handlers for `/api/integrations/*`.
 *
 * `listIntegrations` returns every registered provider plus the calling
 * user's bindings, so the UI can render "Feishu (bound as X / not bound)"
 * without provider-specific code.
 *
 * Lark app management is split into two roles:
 *  - admins can add/remove any app (shared or owned by anyone)
 *  - regular users can add/remove only their own apps, and only when the
 *    `allowUserApps` setting is true (admin-controlled)
 *
 * The list endpoint is open to any authenticated user — both roles need to
 * see what bots exist so they can pick which one to /link with.
 */

import type { Context } from "hono";
import type { ConfigContext } from "../middleware/config.ts";
import type { IntegrationRegistry } from "../integrations/registry.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";
import type { IntegrationsListResponse } from "../../shared/types.ts";
import type { LarkBotManager } from "../lark/manager.ts";
import { LarkAppMgmtError, publicView } from "../lark/appStore.ts";
import { QqAppMgmtError, publicView as publicQqView } from "../qq/appStore.ts";
import type { QqBotManager } from "../qq/manager.ts";
import { canManageProviderApps, getUserRole } from "../auth/userStore.ts";

export interface IntegrationsDeps {
  registry: IntegrationRegistry;
  codes: LinkCodeStore;
  /** Optional: present when admin lifecycle is enabled. */
  larkManager?: LarkBotManager;
  qqManager?: QqBotManager;
}

type CallerRole = "admin" | "user" | "open";

/**
 * Resolve the caller's role for app management.
 *
 * - `open`: auth disabled / shared-token / no users file → effectively admin
 *   (legacy single-user setups)
 * - `admin` / `user`: as recorded in the users file
 */
async function resolveRole(c: Context<ConfigContext>): Promise<CallerRole> {
  const usersFile = (c.var.config as { usersFile?: string } | undefined)
    ?.usersFile;
  if (!usersFile) return "open";
  const user = c.var.authUser;
  if (!user) return "open";
  const role = await getUserRole(usersFile, user);
  return role === "admin" ? "admin" : "user";
}

/**
 * Whether the calling user is allowed to register / remove their own apps
 * for a given integration provider. Admins and "open" callers always can;
 * regular users are gated by their `manageApps` allowlist in the users
 * file.
 */
async function canManageProvider(
  c: Context<ConfigContext>,
  role: CallerRole,
  providerId: string,
): Promise<boolean> {
  if (role === "admin" || role === "open") return true;
  const usersFile = (c.var.config as { usersFile?: string } | undefined)
    ?.usersFile;
  const user = c.var.authUser;
  if (!usersFile || !user) return false;
  return canManageProviderApps(usersFile, user, providerId);
}

export async function handleListIntegrations(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const providers = await Promise.all(
    deps.registry.list().map(async (p) => {
      const enabled = await p.isEnabled();
      return {
        id: p.id,
        displayName: p.displayName,
        enabled,
        bindings: enabled ? await p.listBindings(user) : [],
      };
    }),
  );

  const body: IntegrationsListResponse = { providers };
  return c.json(body);
}

export async function handleIssueLinkCode(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const providerId = c.req.param("provider");
  if (!providerId) return c.json({ error: "Missing provider" }, 400);
  const provider = deps.registry.get(providerId);
  if (!provider) return c.json({ error: "Unknown provider" }, 404);
  if (!(await provider.isEnabled())) {
    return c.json({ error: "Provider is not enabled on the server" }, 400);
  }
  const entry = deps.codes.issue(user, providerId);
  return c.json({
    code: entry.code,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    ttlSeconds: Math.floor(deps.codes.ttlMs() / 1000),
  });
}

export async function handleGetLarkSettings(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.larkManager) {
    return c.json({ error: "Lark management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  // Legacy single-provider settings endpoint, returns the caller's role +
  // whether they can manage lark apps. Kept for back-compat; new UI uses
  // `handleGetIntegrationPermissions` below to get the full per-provider
  // allowlist in one shot.
  const canManageApps = await canManageProvider(c, role, "lark");
  return c.json({ canManageApps, role });
}

export async function handleGetIntegrationPermissions(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  // Admin / open mode = implicitly manage all registered providers.
  if (role === "admin" || role === "open") {
    return c.json({
      role,
      manageApps: deps.registry.list().map((p) => p.id),
    });
  }
  // Regular user: derive from the user record. Each provider id the user
  // has the `manageApps` permission for shows up here, others don't.
  const allowed: string[] = [];
  for (const provider of deps.registry.list()) {
    if (await canManageProvider(c, role, provider.id)) {
      allowed.push(provider.id);
    }
  }
  return c.json({ role, manageApps: allowed });
}

export async function handleListLarkApps(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.larkManager) {
    return c.json({ error: "Lark management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  const records = await deps.larkManager.list();
  return c.json({
    apps: records.map((r) => ({
      ...publicView(r),
      running: deps.larkManager!.isRunning(r.id),
      /** Whether the caller can delete this app. */
      canManage: role === "admin" || role === "open" || r.owner === user,
    })),
  });
}

export async function handleAddLarkApp(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.larkManager) {
    return c.json({ error: "Lark management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  if (!(await canManageProvider(c, role, "lark"))) {
    return c.json(
      {
        error:
          "Adding apps is not allowed for your account. Ask an admin to grant the permission in /admin/users.",
      },
      403,
    );
  }
  let body: {
    appId?: unknown;
    appSecret?: unknown;
    domain?: unknown;
    displayName?: unknown;
    /** Only admins may set this; otherwise the caller becomes the owner. */
    owner?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const appId = typeof body.appId === "string" ? body.appId : "";
  const appSecret = typeof body.appSecret === "string" ? body.appSecret : "";
  const domain =
    body.domain === "lark" || body.domain === "feishu" ? body.domain : "feishu";
  const displayName =
    typeof body.displayName === "string" ? body.displayName : undefined;
  if (!appId || !appSecret) {
    return c.json({ error: "appId and appSecret are required" }, 400);
  }
  // Resolve final owner:
  //  - regular user: always self (regardless of what they sent)
  //  - admin/open: respect body.owner (string = personal-to-someone,
  //    null/empty/missing = shared)
  let owner: string | undefined;
  if (role === "user") {
    owner = user;
  } else if (typeof body.owner === "string" && body.owner.trim()) {
    owner = body.owner.trim();
  } else {
    owner = undefined;
  }
  try {
    const record = await deps.larkManager.add({
      appId,
      appSecret,
      domain,
      displayName,
      owner,
    });
    return c.json({ app: { ...publicView(record), running: true } }, 201);
  } catch (err) {
    if (err instanceof LarkAppMgmtError) {
      const status = err.code === "exists" ? 409 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
}

export async function handleRemoveLarkApp(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.larkManager) {
    return c.json({ error: "Lark management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const role = await resolveRole(c);
  if (role === "user") {
    // Regular users can only remove apps they own.
    const records = await deps.larkManager.list();
    const target = records.find((r) => r.id === id);
    if (!target) return c.json({ error: "App not found" }, 404);
    if (target.owner !== user) {
      return c.json({ error: "You can only remove your own apps" }, 403);
    }
  }
  try {
    await deps.larkManager.remove(id);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof LarkAppMgmtError && err.code === "not-found") {
      return c.json({ error: err.message, code: err.code }, 404);
    }
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

// ─── QQ app management ────────────────────────────────────────────────
//
// Parallels the Lark handlers above. Future cleanup: extract a generic
// "BotManager + AppRecord" interface and drop the duplication.

export async function handleListQqApps(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.qqManager) {
    return c.json({ error: "QQ management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  const records = await deps.qqManager.list();
  return c.json({
    apps: records.map((r) => ({
      ...publicQqView(r),
      running: deps.qqManager!.isRunning(r.id),
      canManage: role === "admin" || role === "open" || r.owner === user,
    })),
  });
}

export async function handleAddQqApp(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.qqManager) {
    return c.json({ error: "QQ management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await resolveRole(c);
  if (!(await canManageProvider(c, role, "qq"))) {
    return c.json(
      {
        error:
          "Adding QQ apps is not allowed for your account. Ask an admin to grant the permission in /admin/users.",
      },
      403,
    );
  }
  let body: {
    appId?: unknown;
    appSecret?: unknown;
    sandbox?: unknown;
    displayName?: unknown;
    owner?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const appId = typeof body.appId === "string" ? body.appId : "";
  const appSecret = typeof body.appSecret === "string" ? body.appSecret : "";
  const sandbox = typeof body.sandbox === "boolean" ? body.sandbox : false;
  const displayName =
    typeof body.displayName === "string" ? body.displayName : undefined;
  if (!appId || !appSecret) {
    return c.json({ error: "appId and appSecret are required" }, 400);
  }
  let owner: string | undefined;
  if (role === "user") {
    owner = user;
  } else if (typeof body.owner === "string" && body.owner.trim()) {
    owner = body.owner.trim();
  } else {
    owner = undefined;
  }
  try {
    const record = await deps.qqManager.add({
      appId,
      appSecret,
      sandbox,
      displayName,
      owner,
    });
    return c.json(
      { app: { ...publicQqView(record), running: true, canManage: true } },
      201,
    );
  } catch (err) {
    if (err instanceof QqAppMgmtError) {
      const status = err.code === "exists" ? 409 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

export async function handleRemoveQqApp(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.qqManager) {
    return c.json({ error: "QQ management not available" }, 404);
  }
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const role = await resolveRole(c);
  if (role === "user") {
    const records = await deps.qqManager.list();
    const target = records.find((r) => r.id === id);
    if (!target) return c.json({ error: "App not found" }, 404);
    if (target.owner !== user) {
      return c.json({ error: "You can only remove your own apps" }, 403);
    }
  }
  try {
    await deps.qqManager.remove(id);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof QqAppMgmtError && err.code === "not-found") {
      return c.json({ error: err.message, code: err.code }, 404);
    }
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

export async function handleRemoveBinding(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const providerId = c.req.param("provider");
  const externalId = c.req.param("externalId");
  if (!providerId || !externalId) {
    return c.json({ error: "Missing path parameters" }, 400);
  }
  const provider = deps.registry.get(providerId);
  if (!provider) return c.json({ error: "Unknown provider" }, 404);
  const ok = await provider.removeBinding(user, externalId);
  if (!ok) return c.json({ error: "Binding not found" }, 404);
  return c.json({ ok: true });
}
