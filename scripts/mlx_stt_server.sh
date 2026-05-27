#!/usr/bin/env bash
# Wrapper to launch mlx_stt_server.py with the mlx-whisper Python venv
# Unset SOCKS proxy — httpx doesn't have socksio; HTTP proxy still works.
unset all_proxy ALL_PROXY
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec /Users/claw/.local/share/uv/tools/mlx-whisper/bin/python \
  "$SCRIPT_DIR/mlx_stt_server.py" "$@"
