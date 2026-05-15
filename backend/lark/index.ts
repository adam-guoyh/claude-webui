/**
 * Lifecycle for the Feishu bot. Connects to Feishu's long-polling endpoint
 * (no public callback URL required), wires the message handler, and exposes
 * a `start()` the CLI entry points can fire-and-forget at boot.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { logger } from "../utils/logger.ts";
import { defaultBindingPath } from "./binding.ts";
import { handleLarkMessage, type LarkHandlerConfig } from "./handler.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

export interface LarkConfig {
  appId: string;
  appSecret: string;
  cliPath: string;
  usersFile: string;
  defaultCwd: string;
  bindingPath?: string;
  /** "feishu" (China) or "lark" (international). Defaults to feishu. */
  domain?: "feishu" | "lark";
  /** Shared link-code store so `/link <code>` works inside the bot. */
  linkCodes?: LinkCodeStore;
}

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

export async function startLarkBot(cfg: LarkConfig): Promise<void> {
  const bindingPath = cfg.bindingPath ?? defaultBindingPath();
  const domain = cfg.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;

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
      logger.cli.error("Lark sendText failed: {error}", { error: e });
    }
  };

  const handlerConfig: LarkHandlerConfig = {
    cliPath: cfg.cliPath,
    usersFile: cfg.usersFile,
    bindingPath,
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
    "im.message.receive_v1": async (data: { event?: ReceiveEvent }) => {
      const ev = data.event;
      const openId = ev?.sender?.sender_id?.open_id;
      const chatId = ev?.message?.chat_id;
      const content = ev?.message?.content;
      const type = ev?.message?.message_type;
      if (!openId || !chatId || !content) return;
      if (type !== "text") {
        await sendText(
          chatId,
          "Only text messages are supported for now. Send /help for commands.",
        );
        return;
      }
      const text = extractText(content);
      await handleLarkMessage({ openId, chatId, text }, handlerConfig);
    },
  });

  // Fire-and-forget; the websocket reconnects on its own. We don't await
  // because `start` blocks indefinitely on the active connection.
  void wsClient.start({ eventDispatcher: dispatcher }).catch((e: unknown) => {
    logger.cli.error("Lark WS client crashed: {error}", { error: e });
  });

  logger.cli.info("🤖 Feishu bot connected (domain={domain})", { domain });
}
