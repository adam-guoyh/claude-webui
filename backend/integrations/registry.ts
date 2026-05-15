/**
 * Provider registry for IM integrations.
 *
 * Each provider knows whether it's currently enabled, how to list the
 * bindings owned by a given webui user, and how to remove one. The HTTP
 * handler treats providers uniformly so adding WeChat / QQ in future is
 * just appending another `IntegrationProvider` (plus that provider's own
 * bot wiring).
 *
 * `isEnabled` is async so providers can derive it from runtime config
 * — e.g. the Lark provider returns true iff at least one app has been
 * registered via the admin UI, with no process restart required.
 */

import type { IntegrationBinding } from "../../shared/types.ts";

export interface IntegrationProvider {
  id: string;
  displayName: string;
  /**
   * True when the backend has at least one configuration that allows the
   * provider to actually exchange messages. May change at runtime.
   */
  isEnabled(): Promise<boolean>;
  /** Return all bindings owned by this webui user. */
  listBindings(username: string): Promise<IntegrationBinding[]>;
  /**
   * Remove a binding by external id, only if it currently belongs to
   * `username`. Returns true on success, false if not found / not owned.
   */
  removeBinding(username: string, externalId: string): Promise<boolean>;
}

export class IntegrationRegistry {
  private readonly providers = new Map<string, IntegrationProvider>();

  register(provider: IntegrationProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): IntegrationProvider | undefined {
    return this.providers.get(id);
  }

  list(): IntegrationProvider[] {
    return Array.from(this.providers.values());
  }
}
