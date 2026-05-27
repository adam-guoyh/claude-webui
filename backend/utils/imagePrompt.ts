/**
 * Builds an AsyncIterable<SDKUserMessage> for turns that include images.
 * The plain-string `prompt` path in the SDK doesn't support multimodal
 * content; this wrapper splices base64 image blocks alongside the user text.
 */
import type { SDKUserMessage } from "@anthropic-ai/claude-code";

export interface AttachedImage {
  /** Raw base64 bytes — no `data:...;base64,` prefix. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export async function* buildImagePrompt(
  text: string,
  images: AttachedImage[],
  sessionId?: string,
): AsyncGenerator<SDKUserMessage> {
  const content = [
    ...images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType,
        data: img.data,
      },
    })),
    ...(text ? [{ type: "text" as const, text }] : []),
  ];
  yield {
    type: "user",
    // MessageParam from @anthropic-ai/sdk — not directly importable since
    // that package is a transitive dep; cast via unknown.
    message: { role: "user", content } as unknown as SDKUserMessage["message"],
    parent_tool_use_id: null,
    session_id: sessionId ?? "",
  } as unknown as SDKUserMessage;
}
