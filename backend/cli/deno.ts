/**
 * Deno-specific entry point
 *
 * This module handles Deno-specific initialization including CLI argument parsing,
 * Claude CLI validation, and server startup using the DenoRuntime.
 */

import { createApp } from "../app.ts";
import { DenoRuntime } from "../runtime/deno.ts";
import { parseCliArgs } from "./args.ts";
import { validateClaudeCli } from "./validation.ts";
import { logger, setupLogger } from "../utils/logger.ts";
import { bootstrapAdminUser } from "../auth/bootstrap.ts";
import { LarkBotManager } from "../lark/manager.ts";
import { defaultBindingPath as defaultLarkBindingPath } from "../lark/binding.ts";
import { defaultAppsPath as defaultLarkAppsPath } from "../lark/appStore.ts";
import { IntegrationRegistry } from "../integrations/registry.ts";
import { LinkCodeStore } from "../integrations/linkCodes.ts";
import { createLarkProvider } from "../integrations/larkProvider.ts";
import { getHomeDir } from "../utils/os.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { exit } from "../utils/os.ts";

async function main(runtime: DenoRuntime) {
  // Parse CLI arguments
  const args = parseCliArgs();

  // Initialize logging system
  await setupLogger(args.debug);

  if (args.debug) {
    logger.cli.info("🐛 Debug mode enabled");
  }

  // Validate Claude CLI availability and get the detected CLI path
  const cliPath = await validateClaudeCli(runtime, args.claudePath);

  // Create application
  const __dirname = dirname(fromFileUrl(import.meta.url));
  const staticPath = join(__dirname, "../dist/static");

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

  let larkManager: LarkBotManager | undefined;
  if (args.usersFile) {
    const defaultCwd = args.larkDefaultCwd ?? getHomeDir() ?? Deno.cwd();
    larkManager = new LarkBotManager({
      appsFilePath: larkAppsPath,
      bindingPath: larkBindingPath,
      cliPath,
      usersFile: args.usersFile,
      defaultCwd,
      linkCodes,
    });
  }

  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath: cliPath,
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
if (import.meta.main) {
  const runtime = new DenoRuntime();
  main(runtime).catch((error) => {
    // Logger may not be initialized yet, so use console.error
    console.error("Failed to start server:", error);
    exit(1);
  });
}
