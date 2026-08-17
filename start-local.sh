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
#   - Starts the local Zalo bridge on loopback :18928 in Docker.
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
  if [[ -f "$ROOT/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.local"
    set +a
  fi
}

compose_local() {
  docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.local.yml" "$@"
}

wait_for_bridge() {
  log "Waiting for local Zalo bridge..."
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:18928/health >/dev/null 2>&1; then
      log "Zalo bridge ready on :18928"
      return 0
    fi
    sleep 1
  done
  err "Zalo bridge failed to start within 30s. Container logs:"
  compose_local logs --tail=40 zalo-agent-bridge >&2 || true
  exit 1
}

resolve_local_zalo_owner() {
  if [[ -n "${ZALO_AGENT_ACCOUNT_OWNER_ID:-}" ]]; then
    return 0
  fi
  local status owner_id
  status="$(curl -fsS \
    -H "Authorization: Bearer ${ZALO_AGENT_BRIDGE_TOKEN}" \
    http://127.0.0.1:18928/status 2>/dev/null || true)"
  owner_id="$(STATUS_JSON="$status" node -e '
    try {
      const data = JSON.parse(process.env.STATUS_JSON || "{}");
      process.stdout.write(String(data.ownId || data.activeAccount?.ownId || ""));
    } catch {}
  ')"
  if [[ -n "$owner_id" ]]; then
    export ZALO_AGENT_ACCOUNT_OWNER_ID="$owner_id"
    log "Using local Zalo account owner: $owner_id"
  else
    warn "Local Zalo bridge has no active account; messaging preflight will be unavailable"
  fi
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
  load_env
  compose_local up -d --build zalo-agent-bridge
  wait_for_bridge
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
  resolve_local_zalo_owner

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
    UPLOAD_DIR="$ROOT/uploads" \
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
  # Admin authentication is implemented by Next.js API routes, so the
  # frontend server also needs ADMIN_PASSWORD and ADMIN_SESSION_SECRET at
  # runtime. This is especially important when running `./start-local.sh
  # frontend` directly (without starting the backend first).
  load_env

  if [[ ! -d "$ROOT/frontend/.next/standalone" || ! -d "$ROOT/frontend/.next/standalone/.next/static" ]]; then
    warn "Frontend standalone build or static assets missing. Building..."
    rebuild_frontend
  else
    # Detect if built with the right API URL — rebuild if config changed.
    local current_url
    current_url="$(node -e "console.log(require('$ROOT/frontend/.next/standalone/server.js'.replace(/server.js$/,'required-server-files.json')).config.env.NEXT_PUBLIC_API_URL || '')" 2>/dev/null || echo "")"
    # This script always targets the local backend. Do not reuse a production
    # NEXT_PUBLIC_API_URL loaded from the root .env, otherwise every local
    # restart incorrectly decides that the build is stale.
    # Keep browser requests same-origin. Next.js proxies /api/* to the local
    # backend, which also ensures the auth cookie set on :4317 is included.
    local want_url=""
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
    BACKEND_INTERNAL_URL="http://127.0.0.1:$BACKEND_PORT" \
    ADMIN_COOKIE_SECURE=false \
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
  log "Building frontend with same-origin API proxy..."
  (
    cd "$ROOT/frontend"
    rm -rf .next
    NEXT_PUBLIC_API_URL="" \
    NEXT_PUBLIC_WS_URL="" \
    BACKEND_INTERNAL_URL="http://127.0.0.1:$BACKEND_PORT" \
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
