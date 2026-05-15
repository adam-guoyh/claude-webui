/**
 * QQ provider scaffold.
 *
 * Registered alongside the Lark provider so the rest of the multi-provider
 * machinery (admin per-user permission checkbox, Integrations binding card)
 * can demonstrate that the framework is provider-agnostic. The actual QQ
 * bot connection isn't wired yet — when we plug in the official QQ bot
 * SDK (qqbot.com WebSocket gateway), only this file's body needs to grow.
 *
 * Until then, `isEnabled` returns false so the Integrations page renders
 * the "preview / not yet configured" hint and the user can't generate
 * link codes for it.
 */

import type { IntegrationBinding } from "../../shared/types.ts";
import type { IntegrationProvider } from "./registry.ts";

export function createQqProvider(): IntegrationProvider {
  return {
    id: "qq",
    displayName: "QQ",

    async isEnabled(): Promise<boolean> {
      // Flip to a real check (e.g. "at least one QQ app registered") once
      // the bot connection lands. Until then we keep it disabled so users
      // can see the framework is multi-provider without us pretending QQ
      // delivery works.
      return false;
    },

    async listBindings(_username: string): Promise<IntegrationBinding[]> {
      return [];
    },

    async removeBinding(
      _username: string,
      _externalId: string,
    ): Promise<boolean> {
      return false;
    },
  };
}
