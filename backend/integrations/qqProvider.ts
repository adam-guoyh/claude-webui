/**
 * QQ provider for the integration registry. Reads from the same nested
 * binding-file structure the Lark provider uses (keyed by appId →
 * openId), just under a separate file path.
 */

import type { IntegrationBinding } from "../../shared/types.ts";
import {
  loadBindings,
  removeBinding as removeBindingFn,
} from "../lark/binding.ts";
import { listApps } from "../qq/appStore.ts";
import type { IntegrationProvider } from "./registry.ts";

export interface QqProviderOptions {
  bindingPath: string;
  appsFilePath: string;
}

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

export function createQqProvider(
  options: QqProviderOptions,
): IntegrationProvider {
  return {
    id: "qq",
    displayName: "QQ",

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
      await removeBindingFn(options.bindingPath, parsed.appId, parsed.openId);
      return true;
    },
  };
}
