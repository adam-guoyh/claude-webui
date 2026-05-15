/**
 * Provider registry for IM integrations.
 *
 * Each provider knows how to list the bindings owned by a given webui user
 * and how to remove one. The HTTP handler treats providers uniformly so
 * adding WeChat / QQ in future is just appending another `IntegrationProvider`
 * to the registry (plus that provider's own bot wiring).
 */

import type { IntegrationBinding } from "../../shared/types.ts";

export interface IntegrationProvider {
  id: string;
  displayName: string;
  /** True when the backend has credentials configured for this provider. */
  enabled: boolean;
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
