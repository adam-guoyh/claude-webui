/**
 * CLI argument parsing using runtime abstraction
 *
 * Handles command-line argument parsing in a runtime-agnostic way.
 */

import { program } from "commander";
import { VERSION } from "./version.ts";
import { getEnv, getArgs } from "../utils/os.ts";

export interface ParsedArgs {
  debug: boolean;
  port: number;
  host: string;
  claudePath?: string;
  authToken?: string;
  /** Path to users.json — enables multi-user mode when set. */
  usersFile?: string;
  /** Feishu / Lark app credentials. When both are set the bot connects. */
  larkAppId?: string;
  larkAppSecret?: string;
  /** "feishu" (default, China) or "lark" (international). */
  larkDomain?: "feishu" | "lark";
  /** Working directory the bot hands to Claude by default. */
  larkDefaultCwd?: string;
  /** OpenAI-compatible STT service base URL (e.g. http://localhost:8010). */
  sttUrl?: string;
}

export function parseCliArgs(): ParsedArgs {
  // Use version from auto-generated version.ts file
  const version = VERSION;

  // Get default port from environment
  const defaultPort = parseInt(getEnv("PORT") || "8080", 10);

  // Configure program
  program
    .name("claude-code-webui")
    .version(version, "-v, --version", "display version number")
    .description("Claude Code Web UI Backend Server")
    .option(
      "-p, --port <port>",
      "Port to listen on",
      (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          throw new Error(`Invalid port number: ${value}`);
        }
        return parsed;
      },
      defaultPort,
    )
    .option(
      "--host <host>",
      "Host address to bind to (use 0.0.0.0 for all interfaces)",
      "127.0.0.1",
    )
    .option(
      "--claude-path <path>",
      "Path to claude executable (overrides automatic detection)",
    )
    .option(
      "--auth-token <token>",
      "Shared bearer token required to access the API (also reads WEBUI_AUTH_TOKEN env var)",
    )
    .option(
      "--users-file <path>",
      "Path to a JSON users file enabling multi-user login (also reads WEBUI_USERS_FILE env var)",
    )
    .option(
      "--lark-app-id <id>",
      "Feishu / Lark app id; enables the bot when paired with --lark-app-secret (also reads WEBUI_LARK_APP_ID)",
    )
    .option(
      "--lark-app-secret <secret>",
      "Feishu / Lark app secret (also reads WEBUI_LARK_APP_SECRET)",
    )
    .option(
      "--lark-domain <domain>",
      'Lark domain: "feishu" (China, default) or "lark" (international) (also reads WEBUI_LARK_DOMAIN)',
    )
    .option(
      "--lark-default-cwd <path>",
      "Default working directory the Lark bot hands to Claude before /cd (also reads WEBUI_LARK_DEFAULT_CWD)",
    )
    .option(
      "--stt-url <url>",
      "OpenAI-compatible Speech-to-Text service base URL, e.g. http://localhost:8010 (also reads WEBUI_STT_URL env var)",
    )
    .option("-d, --debug", "Enable debug mode", false);

  // Parse arguments - Commander.js v14 handles this automatically
  program.parse(getArgs(), { from: "user" });
  const options = program.opts();

  // Handle DEBUG environment variable manually
  const debugEnv = getEnv("DEBUG");
  const debugFromEnv = debugEnv?.toLowerCase() === "true" || debugEnv === "1";

  // Auth token: CLI flag takes precedence, fall back to env var
  const authTokenEnv = getEnv("WEBUI_AUTH_TOKEN");
  const authToken = options.authToken || authTokenEnv || undefined;

  const usersFileEnv = getEnv("WEBUI_USERS_FILE");
  const usersFile = options.usersFile || usersFileEnv || undefined;

  const larkAppId =
    options.larkAppId || getEnv("WEBUI_LARK_APP_ID") || undefined;
  const larkAppSecret =
    options.larkAppSecret || getEnv("WEBUI_LARK_APP_SECRET") || undefined;
  const larkDomainRaw =
    options.larkDomain || getEnv("WEBUI_LARK_DOMAIN") || undefined;
  const larkDomain =
    larkDomainRaw === "lark" || larkDomainRaw === "feishu"
      ? larkDomainRaw
      : undefined;
  const larkDefaultCwd =
    options.larkDefaultCwd || getEnv("WEBUI_LARK_DEFAULT_CWD") || undefined;

  const sttUrl = options.sttUrl || getEnv("WEBUI_STT_URL") || undefined;

  return {
    debug: options.debug || debugFromEnv,
    port: options.port,
    host: options.host,
    claudePath: options.claudePath,
    authToken,
    usersFile,
    larkAppId,
    larkAppSecret,
    larkDomain,
    larkDefaultCwd,
    sttUrl,
  };
}
