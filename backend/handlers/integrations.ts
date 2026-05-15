/**
 * HTTP handlers for `/api/integrations/*`.
 *
 * `listIntegrations` returns every registered provider plus the calling
 * user's bindings, so the UI can render "Feishu (bound as X / not bound)"
 * without provider-specific code.
 */

import type { Context } from "hono";
import type { ConfigContext } from "../middleware/config.ts";
import type { IntegrationRegistry } from "../integrations/registry.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";
import type { IntegrationsListResponse } from "../../shared/types.ts";
import type { LarkBotManager } from "../lark/manager.ts";
import { LarkAppMgmtError, publicView } from "../lark/appStore.ts";

export interface IntegrationsDeps {
  registry: IntegrationRegistry;
  codes: LinkCodeStore;
  /** Optional: present when admin lifecycle is enabled. */
  larkManager?: LarkBotManager;
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

export async function handleListLarkApps(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  if (!deps.larkManager) {
    return c.json({ error: "Lark management not available" }, 404);
  }
  const records = await deps.larkManager.list();
  return c.json({
    apps: records.map((r) => ({
      ...publicView(r),
      running: deps.larkManager!.isRunning(r.id),
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
  let body: {
    appId?: unknown;
    appSecret?: unknown;
    domain?: unknown;
    displayName?: unknown;
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
  try {
    const record = await deps.larkManager.add({
      appId,
      appSecret,
      domain,
      displayName,
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
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
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
