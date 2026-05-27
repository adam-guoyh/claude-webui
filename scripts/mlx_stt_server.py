#!/usr/bin/env python3
"""Minimal OpenAI-compatible STT server backed by mlx-whisper (Apple Silicon GPU)."""
import argparse
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from email import message_from_bytes

import mlx_whisper

MODEL = os.environ.get("STT_MODEL", "mlx-community/whisper-small-mlx")


def _parse_multipart(body: bytes, content_type: str) -> bytes | None:
    wrapped = f"Content-Type: {content_type}\r\n\r\n".encode() + body
    msg = message_from_bytes(wrapped)
    for part in msg.walk():
        cd = part.get("Content-Disposition", "")
        if 'name="file"' in cd:
            return part.get_payload(decode=True)
    return None


class STTHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"INFO:     {self.address_string()} - {fmt % args}", flush=True)

    def do_POST(self):
        if self.path != "/v1/audio/transcriptions":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        ct = self.headers.get("Content-Type", "")

        audio_bytes = _parse_multipart(body, ct)
        if not audio_bytes:
            self._json(400, {"error": "Missing audio file"})
            return

        suffix = ".webm" if b"webm" in body[:32] else ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio_bytes)
            tmp = f.name

        try:
            result = mlx_whisper.transcribe(tmp, path_or_hf_repo=MODEL)
            self._json(200, {"text": result.get("text", "").strip()})
        except Exception as e:
            self._json(500, {"error": str(e)})
        finally:
            os.unlink(tmp)

    def _json(self, status: int, data: dict):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    print(f"INFO:     mlx-whisper STT server starting on port {args.port} (model={MODEL})", flush=True)
    HTTPServer(("0.0.0.0", args.port), STTHandler).serve_forever()
