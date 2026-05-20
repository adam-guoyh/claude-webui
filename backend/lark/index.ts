/**
 * Lifecycle for one Feishu / Lark bot instance.
 *
 * `startLarkBot` connects a single configured app via long-connection and
 * wires its message handler. Returns a stop handle so the higher-level
 * `LarkBotManager` can hot-restart the connection when the admin removes
 * or replaces an app from the web UI.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { logger } from "../utils/logger.ts";
import { defaultBindingPath } from "./binding.ts";
import { handleLarkMessage, type LarkHandlerConfig } from "./handler.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

export interface LarkConfig {
  /** Stable internal id from `appStore`, used for log prefixes. */
  recordId?: string;
  appId: string;
  appSecret: string;
  cliPath: string;
  usersFile: string;
  defaultCwd: string;
  bindingPath?: string;
  domain?: "feishu" | "lark";
  linkCodes?: LinkCodeStore;
}

/**
 * Shape of the `data` argument the SDK's EventDispatcher hands to the
 * `im.message.receive_v1` handler. The SDK unwraps the outer envelope
 * itself, so `sender` / `message` live directly on `data` (NOT under
 * `data.event` as one might guess from the raw webhook JSON).
 */
interface ReceiveEvent {
  message?: {
    chat_id?: string;
    message_id?: string;
    message_type?: string;
    content?: string;
    mentions?: Array<{ key?: string }>;
  };
  sender?: {
    sender_id?: { open_id?: string };
  };
}

export interface LarkBotHandle {
  /** Close the websocket — used by hot-reload to swap an app config. */
  stop(): Promise<void>;
}

/**
 * Extract plain text from the Feishu "text" message JSON payload. Strips
 * any @mentions ("@_user_1" keys) so commands like "@Bot /bind alice ..."
 * dispatch cleanly.
 */
function extractText(rawContent: string): string {
  try {
    const c = JSON.parse(rawContent) as { text?: unknown };
    if (typeof c.text === "string") {
      return c.text
        .replace(/@_user_\d+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
  } catch {
    /* fall through */
  }
  return "";
}

export function startLarkBot(cfg: LarkConfig): LarkBotHandle {
  const bindingPath = cfg.bindingPath ?? defaultBindingPath();
  const domain = cfg.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
  const label = cfg.recordId ? `${cfg.appId} (${cfg.recordId})` : cfg.appId;

  const client = new lark.Client({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    appType: lark.AppType.SelfBuild,
    domain,
  });

  const sendText: LarkHandlerConfig["sendText"] = async (chatId, text) => {
    try {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
    } catch (e) {
      logger.cli.error("Lark sendText failed [{app}]: {error}", {
        app: label,
        error: e,
      });
    }
  };

  const handlerConfig: LarkHandlerConfig = {
    cliPath: cfg.cliPath,
    usersFile: cfg.usersFile,
    bindingPath,
    appId: cfg.appId,
    defaultCwd: cfg.defaultCwd,
    sendText,
    linkCodes: cfg.linkCodes,
  };

  const wsClient = new lark.WSClient({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    loggerLevel: lark.LoggerLevel.warn,
    domain,
  });

  const dispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: ReceiveEvent) => {
      const ev = data;
      const openId = ev?.sender?.sender_id?.open_id;
      const chatId = ev?.message?.chat_id;
      const content = ev?.message?.content;
      const type = ev?.message?.message_type;
      logger.cli.debug(
        "Lark event received [{app}]: type={type} openId={openId} chatId={chatId} hasContent={hasContent}",
        {
          app: label,
          type: type ?? "(missing)",
          openId: openId ?? "(missing)",
          chatId: chatId ?? "(missing)",
          hasContent: Boolean(content),
        },
      );
      if (!openId || !chatId || !content) {
        logger.cli.debug(
          "Lark event dropped [{app}]: missing required field(s)",
          { app: label },
        );
        return;
      }
      if (type !== "text") {
        // Stickers, images, files, voice, cards etc. all fire the same
        // receive_v1 event. Don't bother replying — that just burns
        // outgoing-message quota on noise. The user can /help anytime.
        logger.cli.debug("Lark non-text event ignored [{app}]: type={type}", {
          app: label,
          type,
        });
        return;
      }
      const text = extractText(content);
      // Bare @-mentions or otherwise empty payloads land here as "". Same
      // reasoning: ignore instead of auto-replying with /help, which used
      // to burn a send for every stray mention.
      if (!text) {
        logger.cli.debug("Lark empty-text event ignored [{app}]", {
          app: label,
        });
        return;
      }
      logger.cli.debug("Lark text extracted [{app}]: {len} chars: {preview}", {
        app: label,
        len: text.length,
        preview: text.length > 80 ? text.slice(0, 80) + "…" : text,
      });
      await handleLarkMessage({ openId, chatId, text }, handlerConfig);
    },
  });

  // Fire-and-forget; the websocket reconnects on its own. We don't await
  // because `start` blocks indefinitely on the active connection.
  void wsClient.start({ eventDispatcher: dispatcher }).catch((e: unknown) => {
    logger.cli.error("Lark WS client crashed [{app}]: {error}", {
      app: label,
      error: e,
    });
  });

  logger.cli.info("🤖 Feishu bot connected [{app}] (domain={domain})", {
    app: label,
    domain: cfg.domain ?? "feishu",
  });

  return {
    async stop() {
      // The @larksuiteoapi/node-sdk WSClient doesn't currently expose a
      // documented close method; best-effort try the internal one. Worst
      // case the connection lingers until the process exits — bindings
      // are still removed from disk so it's only a wasted socket.
      const closeable = wsClient as unknown as { close?: () => unknown };
      try {
        if (typeof closeable.close === "function") {
          await Promise.resolve(closeable.close());
        }
      } catch (e) {
        logger.cli.debug("Lark WS close failed [{app}]: {error}", {
          app: label,
          error: e,
        });
      }
      logger.cli.info("🔌 Feishu bot stopped [{app}]", { app: label });
    },
  };
}

export { LarkBotManager } from "./manager.ts";
