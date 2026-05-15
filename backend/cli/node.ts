#!/usr/bin/env node
/**
 * Node.js-specific entry point
 *
 * This module handles Node.js-specific initialization including CLI argument parsing,
 * Claude CLI validation, and server startup using the NodeRuntime.
 */

import { createApp } from "../app.ts";
import { NodeRuntime } from "../runtime/node.ts";
import { parseCliArgs } from "./args.ts";
import { validateClaudeCli } from "./validation.ts";
import { setupLogger, logger } from "../utils/logger.ts";
import { bootstrapAdminUser } from "../auth/bootstrap.ts";
import { startLarkBot } from "../lark/index.ts";
import { defaultBindingPath as defaultLarkBindingPath } from "../lark/binding.ts";
import { IntegrationRegistry } from "../integrations/registry.ts";
import { LinkCodeStore } from "../integrations/linkCodes.ts";
import { createLarkProvider } from "../integrations/larkProvider.ts";
import { getHomeDir } from "../utils/os.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exit } from "../utils/os.ts";

async function main(runtime: NodeRuntime) {
  // Parse CLI arguments
  const args = parseCliArgs();

  // Initialize logging system
  await setupLogger(args.debug);

  if (args.debug) {
    logger.cli.info("🐛 Debug mode enabled");
  }

  // Validate Claude CLI availability and get the detected CLI path
  const cliPath = await validateClaudeCli(runtime, args.claudePath);

  // Use absolute path for static files (supported in @hono/node-server v1.17.0+)
  // Node.js 20.11.0+ compatible with fallback for older versions
  const __dirname =
    import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const staticPath = join(__dirname, "../static");

  // Build the integration registry. Even when no IM provider is configured
  // we mount the registry so `/api/integrations` returns an empty list
  // rather than 404 — the UI displays a "no providers configured" hint.
  const integrationRegistry = new IntegrationRegistry();
  const linkCodes = new LinkCodeStore();
  const larkBindingPath = defaultLarkBindingPath();
  const larkEnabled = Boolean(args.larkAppId && args.larkAppSecret);
  integrationRegistry.register(
    createLarkProvider({
      enabled: larkEnabled,
      bindingPath: larkBindingPath,
    }),
  );

  // Create application
  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath,
    authToken: args.authToken,
    usersFile: args.usersFile,
    integrations: { registry: integrationRegistry, codes: linkCodes },
  });

  if (args.usersFile) {
    await bootstrapAdminUser(args.usersFile);
    logger.cli.info(
      `🔐 Multi-user auth enabled (users file: ${args.usersFile})`,
    );
  } else if (args.authToken) {
    logger.cli.info("🔐 Shared-token auth enabled (Authorization: Bearer)");
  } else {
    logger.cli.info("🔓 Auth disabled (no token or users file configured)");
  }

  // Optional Feishu / Lark bot. Multi-user login is required so the bot
  // can verify /bind credentials against the users file.
  if (larkEnabled) {
    if (!args.usersFile) {
      logger.cli.warn(
        "⚠️  --lark-app-id/secret provided but --users-file is not set; the Feishu bot needs a users file for /bind verification and will not start.",
      );
    } else {
      const defaultCwd = args.larkDefaultCwd ?? getHomeDir() ?? process.cwd();
      await startLarkBot({
        appId: args.larkAppId!,
        appSecret: args.larkAppSecret!,
        cliPath,
        usersFile: args.usersFile,
        defaultCwd,
        domain: args.larkDomain,
        bindingPath: larkBindingPath,
        linkCodes,
      });
    }
  }

  // Start server (only show this message when everything is ready)
  logger.cli.info(`🚀 Server starting on ${args.host}:${args.port}`);
  runtime.serve(args.port, args.host, app.fetch);
}

// Run the application
const runtime = new NodeRuntime();
main(runtime).catch((error) => {
  // Logger may not be initialized yet, so use console.error
  console.error("Failed to start server:", error);
  exit(1);
});
