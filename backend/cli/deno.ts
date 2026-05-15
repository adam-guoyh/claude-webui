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
import { startLarkBot } from "../lark/index.ts";
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

  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath: cliPath,
    authToken: args.authToken,
    usersFile: args.usersFile,
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
  if (args.larkAppId && args.larkAppSecret) {
    if (!args.usersFile) {
      logger.cli.warn(
        "⚠️  --lark-app-id/secret provided but --users-file is not set; the Feishu bot needs a users file for /bind verification and will not start.",
      );
    } else {
      const defaultCwd = args.larkDefaultCwd ?? getHomeDir() ?? Deno.cwd();
      await startLarkBot({
        appId: args.larkAppId,
        appSecret: args.larkAppSecret,
        cliPath,
        usersFile: args.usersFile,
        defaultCwd,
        domain: args.larkDomain,
      });
    }
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
