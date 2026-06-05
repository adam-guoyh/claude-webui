/**
 * Server-side "silent" fire of a pending retry.
 *
 * Re-uses chat.ts's `executeClaudeCommand` async generator and just throws
 * away the yielded stream messages — the underlying claude SDK still writes
 * the new turn into the session's JSONL on disk, so when the user opens the
 * session in the webui again the auto-resumed reply is just there.
 *
 * Failures (still rate-limited / model not available / etc.) end up as the
 * SDK's own result/error message in that JSONL too. We don't re-schedule a
 * retry of the retry — the user can inspect what happened and decide.
 */

import type { PendingRetry } from "../../shared/types.ts";
import { executeClaudeCommand } from "../handlers/chat.ts";
import { logger } from "../utils/logger.ts";

export async function fireRetry(
  entry: PendingRetry,
  cliPath: string,
): Promise<void> {
  // A throw-away controller map — the regular `/api/abort/:requestId` won't
  // ever target this id because we mint it locally and never reveal it.
  const controllers = new Map<string, AbortController>();
  const requestId = `auto-resume-${entry.id}`;

  logger.cli.info(
    "Firing pending retry {id} for session {sessionId} (owner={owner})",
    {
      id: entry.id,
      sessionId: entry.sessionId,
      owner: entry.owner ?? "(open)",
    },
  );

  try {
    for await (const chunk of executeClaudeCommand(
      entry.content,
      requestId,
      controllers,
      cliPath,
      entry.sessionId,
      undefined, // allowedTools — none preserved; the session's own state stands
      entry.workingDirectory,
      // Permission mode pass-through. chat.ts types this as our own
      // PermissionMode (default | plan | acceptEdits | bypassPermissions);
      // entry.permissionMode is a free-form string so we cast in-bounds.
      entry.permissionMode as
        | "default"
        | "plan"
        | "acceptEdits"
        | "bypassPermissions"
        | undefined,
      entry.owner ?? undefined,
      entry.model,
      undefined, // images — not supported in v1 of auto-resume
    )) {
      // Discard. The SDK persists each message to ~/.claude/projects/.../jsonl
      // as it streams, which is the side effect we actually want.
      if (chunk.type === "error") {
        logger.cli.warn(
          "Pending retry {id} reported error: {error}",
          { id: entry.id, error: chunk.error ?? "" },
        );
      }
    }
  } catch (error) {
    logger.cli.error("Pending retry {id} threw: {error}", {
      id: entry.id,
      error,
    });
  }
}
