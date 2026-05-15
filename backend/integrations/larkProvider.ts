/**
 * Lark / Feishu provider for the integration registry.
 *
 * Wraps the on-disk binding store with a username-keyed view (the store
 * itself is keyed by `appId → openId`). externalId on the wire is the
 * composite `${appId}:${openId}` so the UI can both display and remove
 * a specific binding when multiple apps are configured.
 */

import type { IntegrationBinding } from "../../shared/types.ts";
import {
  loadBindings,
  removeBinding as removeLarkBinding,
} from "../lark/binding.ts";
import { listApps } from "../lark/appStore.ts";
import type { IntegrationProvider } from "./registry.ts";

export interface LarkProviderOptions {
  /**
   * Path to lark-bindings.json. The provider always reads the live file
   * so newly-added bindings appear without a restart.
   */
  bindingPath: string;
  /**
   * Path to lark-apps.json. `enabled` is derived from the persisted file
   * so an admin adding an app from the web UI lights up the page without
   * needing a process restart.
   */
  appsFilePath: string;
}

/**
 * Parse a wire-format externalId (`<appId>:<openId>`). Returns null when
 * the value doesn't match — protects against the user passing in
 * arbitrary strings via the DELETE endpoint.
 */
function parseExternalId(
  composite: string,
): { appId: string; openId: string } | null {
  const idx = composite.indexOf(":");
  if (idx <= 0 || idx === composite.length - 1) return null;
  return {
    appId: composite.slice(0, idx),
    openId: composite.slice(idx + 1),
  };
}

export function createLarkProvider(
  options: LarkProviderOptions,
): IntegrationProvider {
  return {
    id: "lark",
    displayName: "Feishu / Lark",

    async isEnabled(): Promise<boolean> {
      const apps = await listApps(options.appsFilePath);
      return apps.length > 0;
    },

    async listBindings(username: string): Promise<IntegrationBinding[]> {
      const all = await loadBindings(options.bindingPath);
      const out: IntegrationBinding[] = [];
      for (const [appId, perApp] of Object.entries(all)) {
        for (const [openId, b] of Object.entries(perApp)) {
          if (b.username !== username) continue;
          out.push({
            externalId: `${appId}:${openId}`,
            cwd: b.cwd,
            sessionId: b.sessionId,
          });
        }
      }
      return out;
    },

    async removeBinding(
      username: string,
      externalId: string,
    ): Promise<boolean> {
      const parsed = parseExternalId(externalId);
      if (!parsed) return false;
      const all = await loadBindings(options.bindingPath);
      const current = all[parsed.appId]?.[parsed.openId];
      if (!current || current.username !== username) return false;
      await removeLarkBinding(options.bindingPath, parsed.appId, parsed.openId);
      return true;
    },
  };
}
