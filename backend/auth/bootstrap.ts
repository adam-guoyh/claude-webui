/**
 * Bootstrap helpers run at process startup.
 *
 * If multi-user mode is enabled (--users-file) and there is no admin in the
 * file yet, create one. Credentials come from WEBUI_ADMIN_USERNAME (defaults
 * to "admin") and WEBUI_ADMIN_PASSWORD; if the password env var is unset we
 * generate a strong random password and print it to stderr exactly once.
 *
 * Printing rather than persisting the plaintext means the operator gets the
 * password in their terminal/log stream but nothing on disk is recoverable.
 */

import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.ts";
import { getEnv } from "../utils/os.ts";
import { ensureAdminUser } from "./userStore.ts";

function generateInitialPassword(): string {
  // base32 over 20 bytes → 32 chars, alphanumeric — easy to copy from a
  // terminal without ambiguous characters (l/1, O/0).
  const alphabet = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export async function bootstrapAdminUser(usersFile: string): Promise<void> {
  const username = getEnv("WEBUI_ADMIN_USERNAME")?.trim() || "admin";
  const envPassword = getEnv("WEBUI_ADMIN_PASSWORD");
  const password =
    envPassword && envPassword.length > 0
      ? envPassword
      : generateInitialPassword();

  const created = await ensureAdminUser(usersFile, username, password);
  if (!created) return;

  if (envPassword && envPassword.length > 0) {
    logger.cli.info(
      `🛡️  Created initial admin user "${username}" from WEBUI_ADMIN_PASSWORD`,
    );
  } else {
    // Make this loud so it can't be missed; it'll never be printed again.
    logger.cli.info("──────────────────────────────────────────────");
    logger.cli.info("🛡️  Initial admin user created");
    logger.cli.info(`     username: ${username}`);
    logger.cli.info(`     password: ${password}`);
    logger.cli.info("   Save this now — it will not be shown again.");
    logger.cli.info(
      "   Override with WEBUI_ADMIN_USERNAME / WEBUI_ADMIN_PASSWORD.",
    );
    logger.cli.info("──────────────────────────────────────────────");
  }
}
