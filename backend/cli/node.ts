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
import { LarkBotManager } from "../lark/manager.ts";
import { defaultBindingPath as defaultLarkBindingPath } from "../lark/binding.ts";
import { defaultAppsPath as defaultLarkAppsPath } from "../lark/appStore.ts";
import { IntegrationRegistry } from "../integrations/registry.ts";
import { LinkCodeStore } from "../integrations/linkCodes.ts";
import { createLarkProvider } from "../integrations/larkProvider.ts";
import { createQqProvider } from "../integrations/qqProvider.ts";
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

  // Build the integration registry. The Lark provider derives "enabled" from
  // the persisted apps file, so the admin UI lights up as soon as any app
  // is registered — no restart required.
  const integrationRegistry = new IntegrationRegistry();
  const linkCodes = new LinkCodeStore();
  const larkBindingPath = defaultLarkBindingPath();
  const larkAppsPath = defaultLarkAppsPath();
  integrationRegistry.register(
    createLarkProvider({
      bindingPath: larkBindingPath,
      appsFilePath: larkAppsPath,
    }),
  );
  // Stub provider — surfaces "QQ" in the admin user-permission UI and on
  // the Integrations page so the multi-provider design is visible.
  // Replace with a real provider implementation when wiring the QQ bot.
  integrationRegistry.register(createQqProvider());

  // Lark bot manager: hot-add / hot-remove app connections from the admin
  // UI. Only meaningful in multi-user mode (admin endpoints are gated to
  // admins). Off-by-default in token-only / open modes — the manager just
  // never gets started, and the admin routes return 404.
  let larkManager: LarkBotManager | undefined;
  if (args.usersFile) {
    const defaultCwd = args.larkDefaultCwd ?? getHomeDir() ?? process.cwd();
    larkManager = new LarkBotManager({
      appsFilePath: larkAppsPath,
      bindingPath: larkBindingPath,
      cliPath,
      usersFile: args.usersFile,
      defaultCwd,
      linkCodes,
    });
  }

  // Create application
  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath,
    authToken: args.authToken,
    usersFile: args.usersFile,
    integrations: {
      registry: integrationRegistry,
      codes: linkCodes,
      larkManager,
    },
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

  // Backward-compatible CLI bootstrap: if --lark-app-id/secret were passed,
  // upsert them into the persisted apps file. Going forward, admins add
  // apps from the web UI instead.
  if (larkManager) {
    if (args.larkAppId && args.larkAppSecret) {
      await larkManager.ensureFromCli({
        appId: args.larkAppId,
        appSecret: args.larkAppSecret,
        domain: args.larkDomain ?? "feishu",
      });
    }
    await larkManager.startAll();
  } else if (args.larkAppId && args.larkAppSecret) {
    logger.cli.warn(
      "⚠️  --lark-app-id/secret provided but --users-file is not set; the Feishu bot needs a users file for /bind verification and will not start.",
    );
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
