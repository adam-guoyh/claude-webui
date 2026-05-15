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

export interface IntegrationsDeps {
  registry: IntegrationRegistry;
  codes: LinkCodeStore;
}

export async function handleListIntegrations(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Promise<Response> {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const providers = await Promise.all(
    deps.registry.list().map(async (p) => ({
      id: p.id,
      displayName: p.displayName,
      enabled: p.enabled,
      bindings: p.enabled ? await p.listBindings(user) : [],
    })),
  );

  const body: IntegrationsListResponse = { providers };
  return c.json(body);
}

export function handleIssueLinkCode(
  c: Context<ConfigContext>,
  deps: IntegrationsDeps,
): Response {
  const user = c.var.authUser;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const providerId = c.req.param("provider");
  if (!providerId) return c.json({ error: "Missing provider" }, 400);
  const provider = deps.registry.get(providerId);
  if (!provider) return c.json({ error: "Unknown provider" }, 404);
  if (!provider.enabled) {
    return c.json({ error: "Provider is not enabled on the server" }, 400);
  }
  const entry = deps.codes.issue(user, providerId);
  return c.json({
    code: entry.code,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    ttlSeconds: Math.floor(deps.codes.ttlMs() / 1000),
  });
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
