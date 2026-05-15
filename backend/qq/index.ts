/**
 * Lifecycle for one QQ official-bot instance.
 *
 * Mirrors `backend/lark/index.ts`: connects via the qq-official-bot SDK's
 * WebSocket gateway (no public URL needed), wires receive-message events
 * into the shared command dispatcher in `backend/lark/handler.ts` with
 * `providerId: "qq"` so `/link <code>` consumes QQ-scoped codes.
 *
 * Intents are limited to `GROUP_AND_C2C_EVENT` for the MVP: group chats
 * (when the bot is @-mentioned) and C2C / friend DMs both fire as
 * `message.group` / `message.private.friend`. Guild support can be added
 * later by also subscribing `PUBLIC_GUILD_MESSAGES`.
 */

import {
  createBot,
  ReceiverMode,
  type GroupMessageEvent,
  type PrivateMessageEvent,
} from "qq-official-bot";
import { logger } from "../utils/logger.ts";
import {
  handleLarkMessage as handleMessage,
  type LarkHandlerConfig,
} from "../lark/handler.ts";
import type { LinkCodeStore } from "../integrations/linkCodes.ts";

export interface QqConfig {
  /** Stable internal id from the app store. */
  recordId?: string;
  appId: string;
  appSecret: string;
  sandbox?: boolean;
  cliPath: string;
  usersFile: string;
  defaultCwd: string;
  bindingPath: string;
  linkCodes?: LinkCodeStore;
}

export interface QqBotHandle {
  stop(): Promise<void>;
}

/**
 * Extract plain text + strip @-mentions from a QQ message. The SDK's
 * `removeAt: true` config option already strips the leading @-mention of
 * the bot itself; this is a defensive belt to also handle the case where
 * removeAt is off or the mention appears mid-text.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/<@!?\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function startQqBot(cfg: QqConfig): QqBotHandle {
  const label = cfg.recordId ? `${cfg.appId} (${cfg.recordId})` : cfg.appId;

  const bot = createBot({
    appid: cfg.appId,
    secret: cfg.appSecret,
    sandbox: !!cfg.sandbox,
    removeAt: true,
    intents: ["GROUP_AND_C2C_EVENT"],
    mode: ReceiverMode.WEBSOCKET,
    logLevel: "warn",
  });

  // Single sendText that routes by sub-event type. QQ requires us to
  // reply on the event object itself rather than addressing a chatId
  // directly (the SDK handles the routing under the hood).
  // We piggy-back on the `chatId` channel in the shared handler config by
  // putting a serialized routing tag there, then a per-event wrapper
  // resolves it back to e.reply(text). See `bridgeSendText` below.
  type Pending = GroupMessageEvent | PrivateMessageEvent;
  const pending = new Map<string, Pending>();

  const bridgeSendText: LarkHandlerConfig["sendText"] = async (
    chatId,
    text,
  ) => {
    const evt = pending.get(chatId);
    if (!evt) {
      logger.cli.warn(
        "QQ sendText could not find originating event [{app}, chat={chat}]",
        { app: label, chat: chatId },
      );
      return;
    }
    try {
      await evt.reply(text);
    } catch (e) {
      logger.cli.error("QQ reply failed [{app}]: {error}", {
        app: label,
        error: e,
      });
    }
  };

  const handlerConfig: LarkHandlerConfig = {
    cliPath: cfg.cliPath,
    usersFile: cfg.usersFile,
    bindingPath: cfg.bindingPath,
    appId: cfg.appId,
    providerId: "qq",
    defaultCwd: cfg.defaultCwd,
    sendText: bridgeSendText,
    linkCodes: cfg.linkCodes,
  };

  const dispatch = async (e: Pending) => {
    // `user_id` is the QQ open-id (provider-stable, opaque). For C2C
    // events the message_id doubles as a chat key, but we need a per-turn
    // routing handle for replies — use the event's id itself.
    const chatId = e.id || e.message_id;
    pending.set(chatId, e);
    try {
      const text = cleanText(e.raw_message || "");
      logger.cli.debug(
        "QQ event received [{app}]: type={type} openId={openId} chat={chat} text={preview}",
        {
          app: label,
          type: e.message_type,
          openId: e.user_id,
          chat: chatId,
          preview: text.length > 60 ? text.slice(0, 60) + "…" : text,
        },
      );
      await handleMessage({ openId: e.user_id, chatId, text }, handlerConfig);
    } finally {
      pending.delete(chatId);
    }
  };

  bot.on("message.group", (e: GroupMessageEvent) => void dispatch(e));
  bot.on(
    "message.private.friend",
    (e: PrivateMessageEvent) => void dispatch(e),
  );

  // qq-official-bot's start() returns a promise that resolves when the
  // WS authentication handshake completes. Fire-and-forget; reconnects
  // are handled internally.
  void bot
    .start()
    .then(() => {
      logger.cli.info("🤖 QQ bot connected [{app}] (sandbox={sandbox})", {
        app: label,
        sandbox: !!cfg.sandbox,
      });
    })
    .catch((err: unknown) => {
      logger.cli.error("QQ bot start failed [{app}]: {error}", {
        app: label,
        error: err,
      });
    });

  return {
    async stop() {
      try {
        await bot.stop();
      } catch (e) {
        logger.cli.debug("QQ bot stop error [{app}]: {error}", {
          app: label,
          error: e,
        });
      }
      logger.cli.info("🔌 QQ bot stopped [{app}]", { app: label });
    },
  };
}
