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
#   CLAUDE_PATH          path to the `claude` binary (default: `which claude`)
#   USERS_FILE           multi-user file (default: $HOME/.claude-webui/users.json)
#   WEBUI_ADMIN_PASSWORD bootstrap admin password (no default)
#   FRONTEND_PORT        Vite dev port (default 3000)
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

PORT="${PORT:-8081}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
USERS_FILE="${USERS_FILE:-$HOME/.claude-webui/users.json}"
CLAUDE_PATH="${CLAUDE_PATH:-$(command -v claude || true)}"
DEBUG="${DEBUG:-}"

STATE_DIR="$HOME/.claude-webui"
RUN_DIR="$STATE_DIR/run"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

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

  log "starting backend on :$PORT (claude=$CLAUDE_PATH, users=$USERS_FILE)"

  # Build cli args. Always has the two flags below, so the array is never
  # empty (which would trip `set -u` on bash 3.2 / macOS default).
  local cli_args=(
    --claude-path "$CLAUDE_PATH"
    --users-file "$USERS_FILE"
  )
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

start_frontend() {
  if is_running "$FRONTEND_PID_FILE"; then
    log "frontend already running (pid $(cat "$FRONTEND_PID_FILE"))"
    return 0
  fi
  log "starting frontend on :$FRONTEND_PORT (proxy backend :$PORT)"
  touch "$FRONTEND_LOG"
  (
    cd "$REPO_ROOT"
    nohup env PORT="$PORT" \
      npm --prefix frontend run dev -- --port "$FRONTEND_PORT" \
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
  for pair in "backend:$BACKEND_PID_FILE" "frontend:$FRONTEND_PID_FILE"; do
    local name="${pair%%:*}" pid_file="${pair##*:}"
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
}

logs_show() {
  local which="${1:-backend}"
  case "$which" in
    backend)  cat "$BACKEND_LOG"  ;;
    frontend) cat "$FRONTEND_LOG" ;;
    *) die "unknown component: $which" ;;
  esac
}

logs_tail() {
  local which="${1:-backend}"
  case "$which" in
    backend)  tail -F "$BACKEND_LOG"  ;;
    frontend) tail -F "$FRONTEND_LOG" ;;
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
      all)       start_backend; start_frontend ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  stop)
    case "$target" in
      backend)   stop_one backend  "$BACKEND_PID_FILE"  ;;
      frontend)  stop_one frontend "$FRONTEND_PID_FILE" ;;
      all)       stop_one frontend "$FRONTEND_PID_FILE"; stop_one backend "$BACKEND_PID_FILE" ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  restart)
    case "$target" in
      backend)   stop_one backend  "$BACKEND_PID_FILE";  start_backend ;;
      frontend)  stop_one frontend "$FRONTEND_PID_FILE"; start_frontend ;;
      all)
        stop_one frontend "$FRONTEND_PID_FILE"
        stop_one backend  "$BACKEND_PID_FILE"
        start_backend
        start_frontend
        ;;
      *) die "unknown target: $target" ;;
    esac
    ;;
  status)  status ;;
  logs)    logs_show "$target" ;;
  tail)    logs_tail "$target" ;;
  -h|--help|help|"")
    cat <<EOF
Usage: scripts/webui.sh <command> [target]

Commands:
  start    [backend|frontend|all]   start services (default: all)
  stop     [backend|frontend|all]   stop services (default: all)
  restart  [backend|frontend|all]   restart services (default: all)
  status                            show running state
  logs     [backend|frontend]       cat the log file (default: backend)
  tail     [backend|frontend]       tail -F the log file (default: backend)

Env defaults can be overridden inline, e.g.:
  PORT=9000 DEBUG=1 scripts/webui.sh start backend

State:
  PIDs  $RUN_DIR/{backend,frontend}.pid
  Logs  $LOG_DIR/{backend,frontend}.log
EOF
    ;;
  *) die "unknown command: $cmd (run with -h for help)" ;;
esac
