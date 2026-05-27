#!/usr/bin/env bash
# claude-webui dev orchestration
#
# A small wrapper around `npm run dev` that:
#  - keeps PID + log files under ~/.claude-webui/run/ and ~/.claude-webui/logs/
#  - supports backend-only, frontend-only, or both
#  - has start / stop / restart / status / logs / tail subcommands
#
# Configure via env vars (or edit the defaults at the top of this file):
#
#   PORT                 backend port (default 8081)
#   HOST                 backend bind host (default 127.0.0.1; use 0.0.0.0 for LAN)
#   CLAUDE_PATH          path to the `claude` binary (default: `which claude`)
#   USERS_FILE           multi-user file (default: $HOME/.claude-webui/users.json)
#   WEBUI_ADMIN_PASSWORD bootstrap admin password (no default)
#   FRONTEND_PORT        Vite dev port (default 3000)
#   FRONTEND_HOST        Vite bind host (default 0.0.0.0 = LAN-accessible)
#   VITE_ALLOWED_HOSTS   comma-separated host whitelist for the dev server,
#                        or "*" to disable (default "*")
#   STT_URL              OpenAI-compatible STT service URL for voice input
#                        e.g. http://localhost:8010  (default: empty = disabled)
#                        When set to a localhost URL, the service is auto-managed.
#   STT_CMD              command to launch the STT service
#                        (default: faster-whisper-server)
#   STT_MODEL            Whisper model to load (default: Systran/faster-whisper-small)
#   DEBUG                set to 1 to add --debug to backend start
#
# Usage:
#   scripts/webui.sh start [backend|frontend|all]   default: all
#   scripts/webui.sh stop  [backend|frontend|all]
#   scripts/webui.sh restart [backend|frontend|all]
#   scripts/webui.sh status
#   scripts/webui.sh logs [backend|frontend]
#   scripts/webui.sh tail [backend|frontend]

set -euo pipefail

# Resolve repo root: this file lives at <repo>/scripts/webui.sh
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Source local env overrides if present (useful when running via bash without .zshrc)
_ENV_FILE="$HOME/.claude-webui/env"
# shellcheck disable=SC1090
[[ -f "$_ENV_FILE" ]] && . "$_ENV_FILE"

PORT="${PORT:-8081}"
HOST="${HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
USERS_FILE="${USERS_FILE:-$HOME/.claude-webui/users.json}"
CLAUDE_PATH="${CLAUDE_PATH:-$(command -v claude || true)}"
STT_URL="${STT_URL:-}"
STT_MODEL="${STT_MODEL:-Systran/faster-whisper-small}"
STT_CMD="${STT_CMD:-faster-whisper-server}"
DEBUG="${DEBUG:-}"

STATE_DIR="$HOME/.claude-webui"
RUN_DIR="$STATE_DIR/run"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
STT_PID_FILE="$RUN_DIR/stt.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
STT_LOG="$LOG_DIR/stt.log"

# Returns 0 (true) when STT_URL is a localhost/127.0.0.1 URL that we should manage.
stt_is_local() {
  [[ -n "$STT_URL" ]] && [[ "$STT_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)? ]]
}

log()  { printf '\033[36m[webui]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[webui]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[webui]\033[0m %s\n' "$*" >&2; exit 1; }

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_backend() {
  if is_running "$BACKEND_PID_FILE"; then
    log "backend already running (pid $(cat "$BACKEND_PID_FILE"))"
    return 0
  fi
  [[ -n "$CLAUDE_PATH" ]] || die "CLAUDE_PATH is empty and \`claude\` was not found in PATH"
  [[ -x "$CLAUDE_PATH" ]] || die "claude binary not executable: $CLAUDE_PATH"
  mkdir -p "$(dirname "$USERS_FILE")"

  log "starting backend on $HOST:$PORT (claude=$CLAUDE_PATH, users=$USERS_FILE${STT_URL:+, stt=$STT_URL})"

  # Build cli args. Always has the flags below, so the array is never
  # empty (which would trip `set -u` on bash 3.2 / macOS default).
  local cli_args=(
    --claude-path "$CLAUDE_PATH"
    --users-file "$USERS_FILE"
    --host "$HOST"
  )
  [[ -n "$STT_URL" ]] && cli_args+=(--stt-url "$STT_URL")
  [[ -n "$DEBUG" ]] && cli_args+=(--debug)

  touch "$BACKEND_LOG"
  (
    cd "$REPO_ROOT"
    nohup env \
      PORT="$PORT" \
      WEBUI_ADMIN_PASSWORD="${WEBUI_ADMIN_PASSWORD:-}" \
      npm --prefix backend run dev -- "${cli_args[@]}" \
      >>"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
    disown 2>/dev/null || true
  )
  sleep 1
  if is_running "$BACKEND_PID_FILE"; then
    log "backend pid=$(cat "$BACKEND_PID_FILE"), log=$BACKEND_LOG"
    if [[ -z "${WEBUI_ADMIN_PASSWORD:-}" ]]; then
      warn "WEBUI_ADMIN_PASSWORD not set — backend will generate a random admin password on first start and print it to the log. Grab it: scripts/webui.sh logs backend | grep -i password"
    fi
  else
    rm -f "$BACKEND_PID_FILE"
    die "backend failed to launch; tail the log: $BACKEND_LOG"
  fi
}

start_stt() {
  stt_is_local || { log "STT_URL is not a localhost URL — skipping managed STT service"; return 0; }
  if is_running "$STT_PID_FILE"; then
    log "stt already running (pid $(cat "$STT_PID_FILE"))"
    return 0
  fi
  # Extract port from STT_URL for the log message
  local stt_port; stt_port="$(echo "$STT_URL" | grep -oE ':[0-9]+' | tr -d ':' || echo "?")"
  log "starting STT service on port $stt_port (cmd: $STT_CMD, model: $STT_MODEL)"
  touch "$STT_LOG"
  (
    cd "$REPO_ROOT"
    # Ensure ~/.local/bin is in PATH for uv-installed tools
    export PATH="$HOME/.local/bin:$PATH"
    local port_arg=""
    [[ "$stt_port" != "?" ]] && port_arg="--port $stt_port"
    # shellcheck disable=SC2086
    nohup env STT_MODEL="$STT_MODEL" $STT_CMD $port_arg >>"$STT_LOG" 2>&1 &
    echo $! >"$STT_PID_FILE"
    disown 2>/dev/null || true
  )
  sleep 2
  if is_running "$STT_PID_FILE"; then
    log "stt pid=$(cat "$STT_PID_FILE"), log=$STT_LOG"
  else
    rm -f "$STT_PID_FILE"
    warn "STT service failed to launch; voice input will not work. Check log: $STT_LOG"
  fi
}

start_frontend() {
  if is_running "$FRONTEND_PID_FILE"; then
    log "frontend already running (pid $(cat "$FRONTEND_PID_FILE"))"
    return 0
  fi
  log "starting frontend on $FRONTEND_HOST:$FRONTEND_PORT (proxy backend :$PORT)"
  touch "$FRONTEND_LOG"
  (
    cd "$REPO_ROOT"
    # VITE_ALLOWED_HOSTS gives the dev server permission to answer
    # requests with the supplied Host header — without it, hitting
    # http://<lan-ip>:3000 returns "Blocked request" even though the
    # socket binds to 0.0.0.0. Default to "*" since the dev server
    # already requires being on the LAN to reach.
    nohup env PORT="$PORT" \
      VITE_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS:-*}" \
      npm --prefix frontend run dev -- \
        --host "$FRONTEND_HOST" \
        --port "$FRONTEND_PORT" \
      >>"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
    disown 2>/dev/null || true
  )
  sleep 1
  if is_running "$FRONTEND_PID_FILE"; then
    log "frontend pid=$(cat "$FRONTEND_PID_FILE"), log=$FRONTEND_LOG"
  else
    rm -f "$FRONTEND_PID_FILE"
    die "frontend failed to launch; tail the log: $FRONTEND_LOG"
  fi
}

stop_one() {
  local name="$1" pid_file="$2"
  if ! is_running "$pid_file"; then
    log "$name not running"
    rm -f "$pid_file"
    return 0
  fi
  local pid
  pid="$(cat "$pid_file")"
  log "stopping $name (pid=$pid)"
  # Kill the whole process group so npm + its child node process both die.
  if kill -TERM "-$pid" 2>/dev/null; then
    :
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  # Wait up to 5s for graceful shutdown.
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$name didn't exit after SIGTERM, sending SIGKILL"
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

status() {
  for pair in "backend:$BACKEND_PID_FILE" "frontend:$FRONTEND_PID_FILE" "stt:$STT_PID_FILE"; do
    local name="${pair%%:*}" pid_file="${pair##*:}"
    if [[ "$name" == "stt" ]] && ! stt_is_local; then
      continue
    fi
    if is_running "$pid_file"; then
      printf '%-9s running (pid=%s)\n' "$name" "$(cat "$pid_file")"
    else
      printf '%-9s stopped\n' "$name"
    fi
  done
  echo
  echo "logs:"
  echo "  backend  $BACKEND_LOG"
  echo "  frontend $FRONTEND_LOG"
  stt_is_local && echo "  stt      $STT_LOG"
}

logs_show() {
  local which="${1:-backend}"
  case "$which" in
    backend)  cat "$BACKEND_LOG"  ;;
    frontend) cat "$FRONTEND_LOG" ;;
    stt)      cat "$STT_LOG"      ;;
    *) die "unknown component: $which" ;;
  esac
}

logs_tail() {
  local which="${1:-backend}"
  case "$which" in
    backend)  tail -F "$BACKEND_LOG"  ;;
    frontend) tail -F "$FRONTEND_LOG" ;;
    stt)      tail -F "$STT_LOG"      ;;
    *) die "unknown component: $which" ;;
  esac
}

cmd="${1:-}"; shift || true
target="${1:-all}"; shift || true

case "$cmd" in
  start)
    case "$target" in
      backend)   start_backend ;;
      frontend)  start_frontend ;;
      stt)       start_stt ;;
      all)       stt_is_local && start_stt; start_backend; start_frontend ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  stop)
    case "$target" in
      backend)   stop_one backend  "$BACKEND_PID_FILE"  ;;
      frontend)  stop_one frontend "$FRONTEND_PID_FILE" ;;
      stt)       stop_one stt      "$STT_PID_FILE" ;;
      all)
        stop_one frontend "$FRONTEND_PID_FILE"
        stop_one backend  "$BACKEND_PID_FILE"
        stt_is_local && stop_one stt "$STT_PID_FILE"
        ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  restart)
    case "$target" in
      backend)   stop_one backend  "$BACKEND_PID_FILE";  start_backend ;;
      frontend)  stop_one frontend "$FRONTEND_PID_FILE"; start_frontend ;;
      stt)       stop_one stt "$STT_PID_FILE"; start_stt ;;
      all)
        stop_one frontend "$FRONTEND_PID_FILE"
        stop_one backend  "$BACKEND_PID_FILE"
        stt_is_local && stop_one stt "$STT_PID_FILE"
        stt_is_local && start_stt
        start_backend
        start_frontend
        ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  status)  status ;;
  logs)    logs_show  "${target:-backend}" ;;
  tail)    logs_tail  "${target:-backend}" ;;
  -h|--help|help|"")
    cat <<EOF
Usage: scripts/webui.sh <command> [target]

Commands:
  start    [backend|frontend|stt|all]   start services (default: all)
  stop     [backend|frontend|stt|all]   stop services (default: all)
  restart  [backend|frontend|stt|all]   restart services (default: all)
  status                                show running state
  logs     [backend|frontend|stt]       cat the log file (default: backend)
  tail     [backend|frontend|stt]       tail -F the log file (default: backend)

Voice input: set STT_URL to a localhost URL to auto-manage the STT service:
  STT_URL=http://localhost:8010 scripts/webui.sh start
  STT_CMD="faster-whisper-server"  (default)
  STT_MODEL="Systran/faster-whisper-small"  (default model)

Env defaults can be overridden inline, e.g.:
  PORT=9000 DEBUG=1 scripts/webui.sh start backend

State:
  PIDs  $RUN_DIR/{backend,frontend}.pid
  Logs  $LOG_DIR/{backend,frontend}.log
EOF
    ;;
  *) die "unknown command: $cmd (run with -h for help)" ;;
esac
