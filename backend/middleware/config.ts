import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../types.ts";

/**
 * Creates configuration middleware that makes app-wide settings available to all handlers
 * via context variables. This eliminates the need to pass configuration parameters
 * to individual handler functions.
 *
 * @param options Configuration options
 * @returns Hono middleware function
 */
export function createConfigMiddleware(options: AppConfig) {
  return createMiddleware<{
    Variables: {
      config: AppConfig;
    };
  }>(async (c, next) => {
    // Set configuration in context for access by handlers
    c.set("config", options);

    await next();
  });
}

/**
 * Type helper to ensure handlers can access the config variable
 * This can be used to extend the context type in handlers if needed.
 * `authUser` is populated by the auth middleware; null when auth is disabled
 * or when the caller used the legacy shared bearer token.
 */
export type ConfigContext = {
  Variables: {
    config: AppConfig;
    authUser: string | null;
  };
};
