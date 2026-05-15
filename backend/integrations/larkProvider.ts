/**
 * Lark / Feishu provider for the integration registry. Wraps the on-disk
 * binding store with a username-keyed view (the store itself is open_id-keyed
 * because the bot looks up bindings by sender).
 */

import type { IntegrationBinding } from "../../shared/types.ts";
import {
  loadBindings,
  removeBinding as removeLarkBinding,
} from "../lark/binding.ts";
import type { IntegrationProvider } from "./registry.ts";

export interface LarkProviderOptions {
  /** True when the backend was started with --lark-app-id/secret. */
  enabled: boolean;
  /** Path to lark-bindings.json. */
  bindingPath: string;
}

export function createLarkProvider(
  options: LarkProviderOptions,
): IntegrationProvider {
  return {
    id: "lark",
    displayName: "Feishu / Lark",
    enabled: options.enabled,

    async listBindings(username: string): Promise<IntegrationBinding[]> {
      const all = await loadBindings(options.bindingPath);
      const out: IntegrationBinding[] = [];
      for (const [openId, b] of Object.entries(all)) {
        if (b.username !== username) continue;
        out.push({
          externalId: openId,
          cwd: b.cwd,
          sessionId: b.sessionId,
        });
      }
      return out;
    },

    async removeBinding(
      username: string,
      externalId: string,
    ): Promise<boolean> {
      const all = await loadBindings(options.bindingPath);
      const current = all[externalId];
      if (!current || current.username !== username) return false;
      await removeLarkBinding(options.bindingPath, externalId);
      return true;
    },
  };
}
