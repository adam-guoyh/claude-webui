/**
 * Message dispatcher for the Feishu bot.
 *
 * Receives `im.message.receive_v1` events, parses out bot commands
 * (`/bind`, `/unbind`, `/new`, `/cd`, `/status`, `/help`), and routes the
 * remaining plain-text messages through Claude via `runLarkChat`.
 */

import { verifyCredentials } from "../auth/userStore.ts";
import { logger } from "../utils/logger.ts";
import {
  getBinding,
  removeBinding,
  setBinding,
  updateBinding,
  type LarkBinding,
} from "./binding.ts";
import { runLarkChat } from "./runner.ts";

export interface LarkHandlerConfig {
  cliPath: string;
  usersFile: string;
  bindingPath: string;
  defaultCwd: string;
  /** Send a text reply to the chat that originated the event. */
  sendText: (chatId: string, text: string) => Promise<void>;
}

interface IncomingMessage {
  openId: string;
  chatId: string;
  /** Already-stripped plain text (the @bot mention prefix has been removed). */
  text: string;
}

/**
 * Best-effort lock so the same user can't pipeline overlapping turns into
 * Claude — each Lark message waits for the previous one to finish. Keyed by
 * binding username (or open_id when unbound, which only happens for /bind).
 */
const inflight = new Map<string, Promise<void>>();

async function serializePerUser(
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = inflight.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  inflight.set(
    key,
    next.finally(() => {
      if (inflight.get(key) === next) inflight.delete(key);
    }),
  );
  await next;
}

function statusLine(binding: LarkBinding): string {
  return [
    `user:      ${binding.username}`,
    `cwd:       ${binding.cwd}`,
    `session:   ${binding.sessionId ? binding.sessionId.slice(0, 8) + "…" : "(new)"}`,
  ].join("\n");
}

const HELP_TEXT = [
  "Available commands:",
  "/bind <username> <password>   link this Feishu account to a webui user",
  "/unbind                        forget the link",
  "/status                        show the current binding",
  "/cd <absolute path>            change the working directory",
  "/new                           start a fresh Claude session",
  "/help                          show this message",
  "",
  "Plain messages are forwarded to Claude under your bound account.",
].join("\n");

/**
 * Dispatch a single incoming message. Returns nothing — all replies happen
 * via the `sendText` callback on the config.
 */
export async function handleLarkMessage(
  msg: IncomingMessage,
  cfg: LarkHandlerConfig,
): Promise<void> {
  const trimmed = msg.text.trim();
  const binding = await getBinding(cfg.bindingPath, msg.openId);
  const lockKey = binding ? binding.username : `pending:${msg.openId}`;

  await serializePerUser(lockKey, async () => {
    try {
      if (trimmed === "" || trimmed === "/help") {
        await cfg.sendText(msg.chatId, HELP_TEXT);
        return;
      }

      if (trimmed.startsWith("/bind ")) {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 3) {
          await cfg.sendText(msg.chatId, "Usage: /bind <username> <password>");
          return;
        }
        const [, username, password] = parts;
        const ok = await verifyCredentials(cfg.usersFile, username, password);
        if (!ok) {
          await cfg.sendText(msg.chatId, "Invalid username or password.");
          return;
        }
        const next: LarkBinding = {
          username,
          cwd: binding?.cwd ?? cfg.defaultCwd,
        };
        await setBinding(cfg.bindingPath, msg.openId, next);
        await cfg.sendText(
          msg.chatId,
          `Bound as ${username}. Working directory: ${next.cwd}\n${HELP_TEXT}`,
        );
        return;
      }

      if (trimmed === "/unbind") {
        if (!binding) {
          await cfg.sendText(msg.chatId, "You're not bound to anything.");
          return;
        }
        await removeBinding(cfg.bindingPath, msg.openId);
        await cfg.sendText(msg.chatId, "Unbound. Use /bind to link again.");
        return;
      }

      if (!binding) {
        await cfg.sendText(
          msg.chatId,
          "You need to /bind <username> <password> first.",
        );
        return;
      }

      if (trimmed === "/status") {
        await cfg.sendText(msg.chatId, statusLine(binding));
        return;
      }

      if (trimmed.startsWith("/cd ")) {
        const newCwd = trimmed.slice("/cd ".length).trim();
        if (!newCwd.startsWith("/")) {
          await cfg.sendText(
            msg.chatId,
            "Path must be absolute (start with /).",
          );
          return;
        }
        await updateBinding(cfg.bindingPath, msg.openId, {
          cwd: newCwd,
          sessionId: undefined, // new directory ⇒ new session
        });
        await cfg.sendText(msg.chatId, `cwd → ${newCwd} (session reset).`);
        return;
      }

      if (trimmed === "/new") {
        await updateBinding(cfg.bindingPath, msg.openId, {
          sessionId: undefined,
        });
        await cfg.sendText(
          msg.chatId,
          "Session reset. Next message starts a new conversation.",
        );
        return;
      }

      // Default: send to Claude.
      logger.cli.debug("Lark→Claude: {user} ({cwd}) — {len} chars", {
        user: binding.username,
        cwd: binding.cwd,
        len: trimmed.length,
      });
      const placeholder = await cfg
        .sendText(msg.chatId, "Thinking…")
        .catch(() => undefined);
      const result = await runLarkChat({
        message: trimmed,
        cliPath: cfg.cliPath,
        workingDirectory: binding.cwd,
        sessionId: binding.sessionId,
        ownerToTag: binding.username,
      });
      // Persist the resolved sessionId so the next turn resumes the same
      // conversation. Idempotent against the on-disk state.
      if (result.sessionId && result.sessionId !== binding.sessionId) {
        await updateBinding(cfg.bindingPath, msg.openId, {
          sessionId: result.sessionId,
        });
      }
      const reply = result.error
        ? `Error: ${result.error}`
        : result.text || "(no text response)";
      await cfg.sendText(msg.chatId, reply);
      // We don't have a message_id from sendText to edit the "Thinking…"
      // placeholder away; the simplest UX is to leave it. Mark it consumed.
      void placeholder;
    } catch (err) {
      logger.cli.error("Lark dispatch failed: {error}", { error: err });
      await cfg.sendText(
        msg.chatId,
        `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
