import type { Context } from "hono";
import type { ConfigContext } from "../middleware/config.ts";

/**
 * Proxy audio to an OpenAI-compatible STT service.
 *
 * Expects multipart/form-data with a `file` field (audio blob).
 * Forwards to `${sttUrl}/v1/audio/transcriptions` and returns
 * `{ text: string }`.
 */
export async function handleSttRequest(
  c: Context<ConfigContext>,
  sttUrl: string | undefined,
): Promise<Response> {
  if (!sttUrl) {
    return c.json(
      {
        error:
          "Speech-to-Text is not configured. Start the server with --stt-url or set WEBUI_STT_URL.",
      },
      503,
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "Missing audio file" }, 400);
  }

  const upstream = new FormData();
  upstream.append("file", file, "audio.webm");
  upstream.append("model", (formData.get("model") as string) || "whisper-1");

  const base = sttUrl.replace(/\/$/, "");
  let resp: Response;
  try {
    resp = await fetch(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      body: upstream,
    });
  } catch (e) {
    return c.json(
      {
        error: `STT service unreachable: ${e instanceof Error ? e.message : e}`,
      },
      502,
    );
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return c.json(
      { error: `STT service returned ${resp.status}: ${body}` },
      502,
    );
  }

  const data = await resp.json();
  return c.json(data);
}
