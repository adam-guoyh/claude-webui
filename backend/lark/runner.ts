/**
 * Thin wrapper around the Claude Code SDK for the Lark bot.
 *
 * The HTTP chat handler in `backend/handlers/chat.ts` does a similar dance
 * but is tied to a streaming HTTP response and a per-request abort map.
 * The bot has different needs:
 *  - We want a final assembled text reply to post into a Feishu message.
 *  - We need to discover the new sessionId from the SDK so we can persist
 *    it on the binding for the next turn.
 *  - We want to tag ownership of any newly-created session to the bound
 *    webui user, just like the HTTP path does.
 */

import { query, type PermissionMode } from "@anthropic-ai/claude-code";
import { getEncodedProjectName } from "../history/pathUtils.ts";
import { setOwner } from "../history/ownershipStore.ts";
import { logger } from "../utils/logger.ts";

export interface RunLarkChatOptions {
  message: string;
  cliPath: string;
  workingDirectory: string;
  /** Resume this session if provided; otherwise Claude starts a fresh one. */
  sessionId?: string;
  /** Webui username to record as owner of the resolved session. */
  ownerToTag?: string;
  permissionMode?: PermissionMode;
  abortController?: AbortController;
}

export interface RunLarkChatResult {
  /** Plain text the bot should send back. May be empty if Claude only ran
   *  tools without producing visible text. */
  text: string;
  /** Whatever session_id Claude reported on the first SDK message — the
   *  conversation the user actually owns. */
  sessionId: string | null;
  /** Names of tools Claude used during this turn, in call order. The
   *  handler renders this as a fallback summary when `text` is empty so
   *  the user can still see what work happened. */
  toolNames: string[];
  /** Final result message's subtype (e.g. "success", "error_max_turns").
   *  Useful for explaining why Claude stopped without saying anything. */
  resultSubtype?: string;
  /** Surface error so the handler can post a "failed" message and not
   *  silently drop the request. */
  error?: string;
}

/**
 * Run a single Claude turn and collect the assembled assistant text.
 *
 * Only the FIRST session_id we observe is treated as "the" session — Claude
 * sometimes emits sidechain ids mid-stream and we don't want to tag those
 * as the user's owned session.
 */
export async function runLarkChat(
  options: RunLarkChatOptions,
): Promise<RunLarkChatResult> {
  const {
    message,
    cliPath,
    workingDirectory,
    sessionId,
    ownerToTag,
    permissionMode,
    abortController,
  } = options;

  let assembled = "";
  let firstSessionId: string | null = null;
  let ownerTagged = false;
  let resultSubtype: string | undefined;
  const toolNames: string[] = [];
  const stderrChunks: string[] = [];

  try {
    for await (const sdkMessage of query({
      prompt: message.startsWith("/") ? message.substring(1) : message,
      options: {
        abortController: abortController ?? new AbortController(),
        executable: "node" as const,
        executableArgs: [],
        pathToClaudeCodeExecutable: cliPath,
        stderr: (data: string) => {
          stderrChunks.push(data);
          logger.cli.debug("Claude CLI stderr (lark): {data}", { data });
        },
        ...(sessionId ? { resume: sessionId } : {}),
        cwd: workingDirectory,
        ...(permissionMode ? { permissionMode } : {}),
      },
    })) {
      const sid = (sdkMessage as { session_id?: unknown }).session_id;
      if (!firstSessionId && typeof sid === "string" && sid) {
        firstSessionId = sid;
        if (ownerToTag && !ownerTagged) {
          ownerTagged = true;
          try {
            const encoded = await getEncodedProjectName(workingDirectory);
            if (encoded) await setOwner(encoded, sid, ownerToTag);
          } catch (e) {
            logger.cli.debug("Failed to tag lark session ownership: {error}", {
              error: e,
            });
          }
        }
      }

      const msgType = (sdkMessage as { type?: string }).type;

      // Collect text content + tool names. Same shape as the SDK's
      // assistant messages — see
      // `frontend/node_modules/@anthropic-ai/claude-code/sdk.d.ts`.
      if (
        msgType === "assistant" &&
        (sdkMessage as { message?: { content?: unknown } }).message
      ) {
        const content = (sdkMessage as { message: { content: unknown } })
          .message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (!item || typeof item !== "object") continue;
            const itemType = (item as { type?: string }).type;
            if (itemType === "text") {
              const text = (item as { text?: unknown }).text;
              if (typeof text === "string") assembled += text;
            } else if (itemType === "tool_use") {
              const name = (item as { name?: unknown }).name;
              if (typeof name === "string") toolNames.push(name);
            }
          }
        } else if (typeof content === "string") {
          assembled += content;
        }
      }

      // Capture the final result message's subtype so the handler can
      // explain *why* Claude stopped (max-turns, error, etc.) when the
      // assistant didn't say anything itself.
      if (msgType === "result") {
        const sub = (sdkMessage as { subtype?: unknown }).subtype;
        if (typeof sub === "string") resultSubtype = sub;
      }
    }

    return {
      text: assembled.trim(),
      sessionId: firstSessionId,
      toolNames,
      resultSubtype,
    };
  } catch (error) {
    const stderrTail = stderrChunks.join("").trim().slice(-1500);
    const msg = error instanceof Error ? error.message : String(error);
    return {
      text: assembled.trim(),
      sessionId: firstSessionId,
      toolNames,
      resultSubtype,
      error: stderrTail ? `${msg}\n--- stderr ---\n${stderrTail}` : msg,
    };
  }
}
