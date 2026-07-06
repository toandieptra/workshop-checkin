#!/bin/bash
# Start workshop-checkin locally (outside Docker Compose).
#
# Usage:
#   ./start-local.sh            # start backend + frontend
#   ./start-local.sh backend    # start only backend
#   ./start-local.sh frontend   # start only frontend
#   ./start-local.sh stop       # stop both
#   ./start-local.sh rebuild    # rebuild frontend + restart
#
# Behavior:
#   - Reads ../.env to populate all LARK_* vars and other secrets.
#   - Overrides POSTGRES_HOST/REDIS_HOST to localhost + their exposed
#     Docker ports (5547/6387), so the backend can talk to the host-
#     mapped Postgres/Redis containers.
#   - Starts backend on :8427 and frontend on :4317 in background,
#     logs go to /tmp/backend.log and /tmp/frontend.log.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BACKEND_LOG="/tmp/backend.log"
FRONTEND_LOG="/tmp/frontend.log"
BACKEND_PORT="${BACKEND_PORT:-8427}"
FRONTEND_PORT="${FRONTEND_PORT:-4317}"

# ── helpers ────────────────────────────────────────────────────────
log() { printf "\033[1;34m[start-local]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[start-local]\033[0m %s\n" "$*" >&2; }
err() { printf "\033[1;31m[start-local]\033[0m %s\n" "$*" >&2; }

load_env() {
  local envfile="$ROOT/.env"
  if [[ ! -f "$envfile" ]]; then
    err ".env not found at $envfile"
    exit 1
  fi
  # Export every VAR=VALUE line so child processes inherit them.
  set -a
  # shellcheck disable=SC1090
  source "$envfile"
  set +a
}

ensure_docker() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q workshop-checkin-postgres-1; then
    log "Starting Postgres + Redis via docker compose..."
    docker compose up -d postgres redis
    log "Waiting for Postgres (5547)..."
    for i in $(seq 1 30); do
      nc -z localhost 5547 && break
      sleep 1
    done
    nc -z localhost 5547 || { err "Postgres did not come up on :5547"; exit 1; }
    log "Waiting for Redis (6387)..."
    for i in $(seq 1 15); do
      nc -z localhost 6387 && break
      sleep 1
    done
  else
    log "Postgres + Redis already running"
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    warn "Killing existing processes on :$port -> $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

start_backend() {
  ensure_docker
  load_env

  if [[ ! -d "$ROOT/backend/.venv" ]]; then
    err "Backend venv missing at $ROOT/backend/.venv. Create it first:"
    err "  /opt/homebrew/bin/python3.12 -m venv backend/.venv"
    err "  backend/.venv/bin/pip install -r backend/requirements.txt greenlet"
    exit 1
  fi

  kill_port "$BACKEND_PORT"

  log "Starting backend on :$BACKEND_PORT (log: $BACKEND_LOG)"
  (
    cd "$ROOT/backend"
    # Override host networking to talk to host-mapped container ports.
    # LARK_* and other secrets come from .env via load_env().
    POSTGRES_HOST=localhost POSTGRES_PORT=5547 \
    REDIS_HOST=localhost    REDIS_PORT=6387 \
    nohup ./.venv/bin/python -m uvicorn app.main:app \
      --host 0.0.0.0 --port "$BACKEND_PORT" \
      > "$BACKEND_LOG" 2>&1 &
    echo $! > /tmp/backend.pid
  )

  log "Waiting for backend..."
  for i in $(seq 1 20); do
    if curl -sf "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
      log "Backend ready (PID $(cat /tmp/backend.pid))"
      return 0
    fi
    sleep 1
  done
  err "Backend failed to start within 20s. Last 20 log lines:"
  tail -20 "$BACKEND_LOG" >&2
  exit 1
}

start_frontend() {
  if [[ ! -d "$ROOT/frontend/.next/standalone" ]]; then
    warn "Frontend standalone build missing. Building..."
    rebuild_frontend
  else
    # Detect if built with the right API URL — rebuild if config changed.
    local current_url
    current_url="$(node -e "console.log(require('$ROOT/frontend/.next/standalone/server.js'.replace(/server.js$/,'required-server-files.json')).config.env.NEXT_PUBLIC_API_URL || '')" 2>/dev/null || echo "")"
    local want_url="${NEXT_PUBLIC_API_URL:-http://localhost:$BACKEND_PORT/api}"
    if [[ "$current_url" != "$want_url" ]]; then
      warn "Frontend built with NEXT_PUBLIC_API_URL=$current_url, want $want_url — rebuilding"
      rebuild_frontend
    fi
  fi

  kill_port "$FRONTEND_PORT"

  log "Starting frontend on :$FRONTEND_PORT (log: $FRONTEND_LOG)"
  (
    cd "$ROOT/frontend/.next/standalone"
    PORT="$FRONTEND_PORT" \
    nohup node server.js > "$FRONTEND_LOG" 2>&1 &
    echo $! > /tmp/frontend.pid
  )

  log "Waiting for frontend..."
  for i in $(seq 1 20); do
    if curl -sf -o /dev/null "http://localhost:$FRONTEND_PORT"; then
      log "Frontend ready (PID $(cat /tmp/frontend.pid))"
      return 0
    fi
    sleep 1
  done
  err "Frontend failed to start within 20s. Last 20 log lines:"
  tail -20 "$FRONTEND_LOG" >&2
  exit 1
}

rebuild_frontend() {
  log "Building frontend (NEXT_PUBLIC_API_URL=http://localhost:$BACKEND_PORT/api)..."
  (
    cd "$ROOT/frontend"
    rm -rf .next
    NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT/api" \
    NEXT_PUBLIC_WS_URL="ws://localhost:$BACKEND_PORT/ws" \
    npm run build
    cp -r .next/static .next/standalone/.next/static
    cp -r public .next/standalone/public 2>/dev/null || true
  )
}

stop_all() {
  log "Stopping backend + frontend..."
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  rm -f /tmp/backend.pid /tmp/frontend.pid
  log "Done."
}

status() {
  local bpid="" fpid=""
  [[ -f /tmp/backend.pid ]] && bpid="$(cat /tmp/backend.pid)"
  [[ -f /tmp/frontend.pid ]] && fpid="$(cat /tmp/frontend.pid)"
  echo "backend  :$(lsof -ti:$BACKEND_PORT 2>/dev/null | head -1 | sed 's/^/ pid=/')  ${bpid:+saved_pid=$bpid}"
  echo "frontend :$(lsof -ti:$FRONTEND_PORT 2>/dev/null | head -1 | sed 's/^/ pid=/') ${fpid:+saved_pid=$fpid}"
}

# ── dispatch ───────────────────────────────────────────────────────
cmd="${1:-all}"
case "$cmd" in
  all|"")     start_backend; start_frontend; status ;;
  backend)    start_backend; status ;;
  frontend)   start_frontend; status ;;
  rebuild)
    rebuild_frontend
    start_backend; start_frontend; status
    ;;
  stop)       stop_all ;;
  status)     status ;;
  restart)    stop_all; start_backend; start_frontend; status ;;
  *)
    err "Unknown command: $cmd"
    echo "Usage: $0 [all|backend|frontend|rebuild|stop|status|restart]"
    exit 2
    ;;
esac

echo
log "Ready."
log "  Admin     → http://localhost:$FRONTEND_PORT/admin"
log "  Thong ke  → http://localhost:$FRONTEND_PORT/admin/thong-ke"
log "  Welcome   → http://localhost:$FRONTEND_PORT/welcome"
log "  Backend   → http://localhost:$BACKEND_PORT/api/health"