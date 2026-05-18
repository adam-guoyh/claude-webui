/**
 * Message dispatcher for the Feishu bot.
 *
 * Receives `im.message.receive_v1` events, parses out bot commands
 * (`/bind`, `/unbind`, `/new`, `/cd`, `/status`, `/help`), and routes the
 * remaining plain-text messages through Claude via `runLarkChat`.
 */

import { getUserRole, verifyCredentials } from "../auth/userStore.ts";
import { logger } from "../utils/logger.ts";
import {
  getBinding,
  removeBinding,
  setBinding,
  updateBinding,
  type LarkBinding,
} from "./binding.ts";
import { runLarkChat, type RunLarkChatResult } from "./runner.ts";
import { listUserSessionsInCwd, type SessionRow } from "./sessions.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

const VALID_PERM_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
] as const;
type PermMode = (typeof VALID_PERM_MODES)[number];

/**
 * Build the user-facing reply for a Claude turn. Falls back to a tool
 * usage summary when Claude finished without text (typical for "just go
 * do it" requests where the assistant skips a closing remark).
 */
function buildReply(result: RunLarkChatResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }
  if (result.text) return result.text;
  if (result.toolNames.length > 0) {
    const counts = new Map<string, number>();
    for (const name of result.toolNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const summary = Array.from(counts.entries())
      .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
      .join(", ");
    return `✓ Done. Used tools: ${summary}. (No text from the model.)`;
  }
  if (result.resultSubtype && result.resultSubtype !== "success") {
    return `Claude stopped: ${result.resultSubtype}. (No text emitted.)`;
  }
  return "(no text response)";
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatSessionLine(row: SessionRow, i: number): string {
  const label =
    row.customTitle ||
    (row.lastMessagePreview
      ? row.lastMessagePreview.replace(/\s+/g, " ").slice(0, 60)
      : "(no preview)");
  return `${i + 1}. ${row.sessionId.slice(0, 8)}… · ${relativeTime(row.lastTime)} · ${row.messageCount} msgs · ${label}`;
}

export interface LarkHandlerConfig {
  cliPath: string;
  usersFile: string;
  bindingPath: string;
  /** Which Feishu app this dispatcher belongs to — keys the binding store. */
  appId: string;
  defaultCwd: string;
  /**
   * Integration provider id. Defaults to "lark" for backward compat; QQ
   * passes "qq" so /link consumes codes for the right provider.
   */
  providerId?: string;
  /** Send a text reply to the chat that originated the event. */
  sendText: (chatId: string, text: string) => Promise<void>;
  /**
   * Optional link-code store. When provided, `/link <code>` is accepted as
   * an alternative to `/bind <user> <pass>`. The store is shared with the
   * HTTP `/api/integrations/:provider/code` endpoint.
   */
  linkCodes?: LinkCodeStore;
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

/**
 * Known bot commands. Used to normalize input from clients that intercept
 * a literal "/" (QQ turns it into the slash-command lightning emoji and
 * the user ends up unable to send `/link …` at all). If the first word
 * matches one of these, we silently prepend "/" so the rest of the
 * dispatcher's `trimmed.startsWith("/foo")` checks keep working.
 */
const KNOWN_COMMANDS = new Set([
  "help",
  "link",
  "bind",
  "unbind",
  "status",
  "cd",
  "list",
  "resume",
  "new",
  "perms",
]);

function normalizeCommand(input: string): string {
  if (!input || input.startsWith("/")) return input;
  const idx = input.search(/\s/);
  const firstWord = (idx === -1 ? input : input.slice(0, idx)).toLowerCase();
  return KNOWN_COMMANDS.has(firstWord) ? `/${input}` : input;
}

function statusLine(binding: LarkBinding): string {
  return [
    `user:      ${binding.username}`,
    `cwd:       ${binding.cwd}`,
    `session:   ${binding.sessionId ? binding.sessionId.slice(0, 8) + "…" : "(new)"}`,
    `perms:     ${binding.permissionMode ?? "bypassPermissions (default)"}`,
  ].join("\n");
}

const HELP_TEXT = [
  "Available commands:",
  "/link <code>                   pair using a code from the web UI's Integrations page",
  "/bind <username> <password>   link this Feishu account to a webui user",
  "/unbind                        forget the link",
  "/status                        show the current binding",
  "/cd <absolute path>            change the working directory",
  "/list                          list your recent sessions in the current cwd",
  "/resume <sessionId or 8-char>  continue an existing webui session",
  "/new                           start a fresh Claude session",
  "/perms <mode>                  set Claude permission mode (default | acceptEdits | bypassPermissions | plan)",
  "/help                          show this message",
  "",
  "Plain messages are forwarded to Claude under your bound account.",
  "Default permission mode is bypassPermissions — the bot can't answer",
  "permission prompts, so they'd otherwise hang the turn.",
].join("\n");

/**
 * Dispatch a single incoming message. Returns nothing — all replies happen
 * via the `sendText` callback on the config.
 */
export async function handleLarkMessage(
  msg: IncomingMessage,
  cfg: LarkHandlerConfig,
): Promise<void> {
  const trimmed = normalizeCommand(msg.text.trim());
  const binding = await getBinding(cfg.bindingPath, cfg.appId, msg.openId);
  const lockKey = binding
    ? binding.username
    : `pending:${cfg.appId}:${msg.openId}`;

  logger.cli.debug(
    "Lark dispatch [{app}]: openId={openId} bound={bound} text={preview}",
    {
      app: cfg.appId,
      openId: msg.openId,
      bound: binding ? binding.username : "(none)",
      preview: trimmed.length > 60 ? trimmed.slice(0, 60) + "…" : trimmed,
    },
  );

  await serializePerUser(lockKey, async () => {
    try {
      if (trimmed === "" || trimmed === "/help") {
        await cfg.sendText(msg.chatId, HELP_TEXT);
        return;
      }

      if (trimmed.startsWith("/link ") || trimmed === "/link") {
        if (!cfg.linkCodes) {
          await cfg.sendText(
            msg.chatId,
            "Code-based linking is not enabled on this server. Use /bind <username> <password>.",
          );
          return;
        }
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 2) {
          await cfg.sendText(
            msg.chatId,
            "Usage: /link <code>   (get the code from the web UI's Integrations page)",
          );
          return;
        }
        const code = parts[1];
        const username = cfg.linkCodes.consume(code, cfg.providerId ?? "lark");
        if (!username) {
          await cfg.sendText(
            msg.chatId,
            "That code is invalid or expired. Generate a new one in the web UI.",
          );
          return;
        }
        // Defensive: the user could have been deleted between code issue
        // and consumption.
        const role = await getUserRole(cfg.usersFile, username);
        if (!role) {
          await cfg.sendText(
            msg.chatId,
            `The user "${username}" no longer exists. Ask an admin to recreate it.`,
          );
          return;
        }
        const next: LarkBinding = {
          username,
          cwd: binding?.cwd ?? cfg.defaultCwd,
        };
        await setBinding(cfg.bindingPath, cfg.appId, msg.openId, next);
        await cfg.sendText(
          msg.chatId,
          `Linked as ${username}. Working directory: ${next.cwd}\n${HELP_TEXT}`,
        );
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
        await setBinding(cfg.bindingPath, cfg.appId, msg.openId, next);
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
        await removeBinding(cfg.bindingPath, cfg.appId, msg.openId);
        await cfg.sendText(msg.chatId, "Unbound. Use /bind to link again.");
        return;
      }

      if (!binding) {
        await cfg.sendText(
          msg.chatId,
          "You need to pair this account first. Either run /link <code> with a code from the web UI's Integrations page, or /bind <username> <password>.",
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
        await updateBinding(cfg.bindingPath, cfg.appId, msg.openId, {
          cwd: newCwd,
          sessionId: undefined, // new directory ⇒ new session
        });
        await cfg.sendText(msg.chatId, `cwd → ${newCwd} (session reset).`);
        return;
      }

      if (trimmed === "/list") {
        const rows = await listUserSessionsInCwd(binding.cwd, binding.username);
        if (rows.length === 0) {
          await cfg.sendText(
            msg.chatId,
            `No sessions yet under ${binding.cwd}. Send a message to start one.`,
          );
          return;
        }
        const top = rows.slice(0, 8);
        const body = [
          `Your recent sessions under ${binding.cwd}:`,
          ...top.map(formatSessionLine),
          "",
          "Continue one with: /resume <sessionId-or-first-8-chars>",
        ].join("\n");
        await cfg.sendText(msg.chatId, body);
        return;
      }

      if (trimmed.startsWith("/resume ") || trimmed === "/resume") {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 2) {
          await cfg.sendText(
            msg.chatId,
            "Usage: /resume <sessionId-or-first-8-chars>   (use /list to see options)",
          );
          return;
        }
        const target = parts[1].toLowerCase();
        const rows = await listUserSessionsInCwd(binding.cwd, binding.username);
        const matches = rows.filter((r) =>
          r.sessionId.toLowerCase().startsWith(target),
        );
        if (matches.length === 0) {
          await cfg.sendText(
            msg.chatId,
            `No session matches "${parts[1]}" under ${binding.cwd}. Try /list.`,
          );
          return;
        }
        if (matches.length > 1) {
          const previews = matches
            .slice(0, 5)
            .map(formatSessionLine)
            .join("\n");
          await cfg.sendText(
            msg.chatId,
            `Multiple sessions match "${parts[1]}". Use a longer prefix:\n${previews}`,
          );
          return;
        }
        const picked = matches[0];
        await updateBinding(cfg.bindingPath, cfg.appId, msg.openId, {
          sessionId: picked.sessionId,
        });
        const label = picked.customTitle || picked.lastMessagePreview || "";
        await cfg.sendText(
          msg.chatId,
          `Resumed session ${picked.sessionId.slice(0, 8)}…${label ? ` — "${label.slice(0, 80)}"` : ""}. Next message continues this conversation.`,
        );
        return;
      }

      if (trimmed.startsWith("/perms ") || trimmed === "/perms") {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 2) {
          await cfg.sendText(
            msg.chatId,
            `Usage: /perms <mode>   modes: ${VALID_PERM_MODES.join(" | ")}`,
          );
          return;
        }
        const mode = parts[1] as PermMode;
        if (!(VALID_PERM_MODES as readonly string[]).includes(mode)) {
          await cfg.sendText(
            msg.chatId,
            `Unknown mode "${parts[1]}". Valid: ${VALID_PERM_MODES.join(" | ")}.`,
          );
          return;
        }
        await updateBinding(cfg.bindingPath, cfg.appId, msg.openId, {
          permissionMode: mode,
        });
        await cfg.sendText(msg.chatId, `Permission mode → ${mode}.`);
        return;
      }

      if (trimmed === "/new") {
        await updateBinding(cfg.bindingPath, cfg.appId, msg.openId, {
          sessionId: undefined,
        });
        await cfg.sendText(
          msg.chatId,
          "Session reset. Next message starts a new conversation.",
        );
        return;
      }

      // Default: send to Claude.
      logger.cli.debug(
        "Lark→Claude: {user} ({cwd}) — {len} chars, perm={perm}",
        {
          user: binding.username,
          cwd: binding.cwd,
          len: trimmed.length,
          perm: binding.permissionMode ?? "bypassPermissions (default)",
        },
      );
      const placeholder = await cfg
        .sendText(msg.chatId, "Thinking…")
        .catch(() => undefined);
      // Default to bypassPermissions for the bot — there's no UI in
      // Feishu to answer per-tool permission prompts, so the SDK's
      // ask-each-time default would hang the turn. Users can opt into
      // stricter modes via `/perms`.
      const result = await runLarkChat({
        message: trimmed,
        cliPath: cfg.cliPath,
        workingDirectory: binding.cwd,
        sessionId: binding.sessionId,
        ownerToTag: binding.username,
        permissionMode: binding.permissionMode ?? "bypassPermissions",
      });
      // Persist the resolved sessionId so the next turn resumes the same
      // conversation. Idempotent against the on-disk state.
      if (result.sessionId && result.sessionId !== binding.sessionId) {
        await updateBinding(cfg.bindingPath, cfg.appId, msg.openId, {
          sessionId: result.sessionId,
        });
      }
      const reply = buildReply(result);
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
