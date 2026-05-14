/**
 * Backend-specific type definitions
 */

import type { Runtime } from "./runtime/types.ts";

// Application configuration shared across backend handlers
export interface AppConfig {
  debugMode: boolean;
  runtime: Runtime;
  cliPath: string; // Path to actual CLI script detected by validateClaudeCli
  /** Present when multi-user mode is enabled — handlers use it to resolve roles. */
  usersFile?: string;
}
