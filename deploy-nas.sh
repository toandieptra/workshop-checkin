#!/usr/bin/env sh
# Workshop Check-in deploy (NAS Synology)
# - Uses the existing 'default' buildx builder (driver: docker, buildkit
#   already running). Will NOT create a new buildx container.
# - Builds backend + frontend as linux/amd64 via buildx --load so images
#   land in the local docker daemon.
# - Tags built images as :latest only (no :amd64 intermediate tags).
# - Force-recreates containers and verifies health endpoints.
set -eu

cd "$(dirname "$0")"

export PATH="/var/packages/ContainerManager/target/usr/bin:${PATH}"
DOCKER_BIN="${DOCKER_BIN:-docker}"

if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  echo "ERROR: docker not found in PATH" >&2
  exit 1
fi

APP_URL="${APP_URL:-https://workshop.hisweetievietnam.com}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8087}"
COMPOSE_PROJECT="workshop-checkin"
BRIDGE_PROJECT="workshop-zalo-runtime"
BRIDGE_SERVICE="zalo-agent-bridge"

echo "== Workshop Check-in deploy =="
echo "Project: $(pwd)"
echo "Compose project: $COMPOSE_PROJECT"
echo "Docker: $($DOCKER_BIN --version)"
echo "Compose: $($DOCKER_BIN compose version)"

echo "[1/5] Validate compose"
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" config >/dev/null

echo "[2/5] Pin buildx to 'default' (do not create new builder)"
if ! "$DOCKER_BIN" buildx inspect default >/dev/null 2>&1; then
  echo "ERROR: buildx 'default' not found. Available builders:" >&2
  "$DOCKER_BIN" buildx ls >&2 || true
  exit 1
fi
"$DOCKER_BIN" buildx use default
"$DOCKER_BIN" buildx inspect default | head -5

echo "[3/5] Build images (linux/amd64, --pull, --load) via default builder -> :latest"
"$DOCKER_BIN" buildx build --pull --load --platform=linux/amd64 \
  -t workshop-checkin-backend:latest -f backend/Dockerfile backend

WS_HOST="$(printf %s "$APP_URL" | sed -E 's#^https?://##')"
WS_SCHEME="ws"
case "$APP_URL" in
  https://*) WS_SCHEME="wss" ;;
esac
"$DOCKER_BIN" buildx build --pull --load --platform=linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL="$APP_URL/api" \
  --build-arg NEXT_PUBLIC_WS_URL="${WS_SCHEME}://${WS_HOST}/ws" \
  -t workshop-checkin-frontend:latest -f frontend/Dockerfile frontend

"$DOCKER_BIN" buildx build --pull --load --platform=linux/amd64 \
  -t workshop-checkin-zalo-agent-bridge:latest -f tools/zalo-agent-bridge/Dockerfile tools/zalo-agent-bridge

echo "[4/5] Recreate containers"
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" up -d --force-recreate \
  postgres redis backend frontend nginx
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/027_guest_notes.sql
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/028_lark_outbound_only.sql
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/029_zalo_connections_permissions.sql
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/030_zalo_templates_messages.sql
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/031_zalo_granular_permissions.sql
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/032_zalo_template_auto_send.sql

echo "[5/5] Wait for health"
sleep 8
"$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" ps

if command -v curl >/dev/null 2>&1; then
  printf "%s\n" "- App root: $HEALTH_URL/"
  curl -fsS "$HEALTH_URL/" >/dev/null && printf "  OK\n" || printf "  WARN: app root not ready\n"
  printf "\n%s\n" "- API health: $HEALTH_URL/api/health"
  curl -fsS "$HEALTH_URL/api/health" && printf "\n"
  printf "%s\n" "- Zalo bridge: $BRIDGE_PROJECT/$BRIDGE_SERVICE"
  BRIDGE_CONTAINERS="$(
    "$DOCKER_BIN" ps \
      --filter "label=com.docker.compose.project=$BRIDGE_PROJECT" \
      --filter "label=com.docker.compose.service=$BRIDGE_SERVICE" \
      --format '{{.ID}}'
  )"
  BRIDGE_COUNT="$(printf '%s\n' "$BRIDGE_CONTAINERS" | grep -c . || true)"
  if [ "$BRIDGE_COUNT" -ne 1 ]; then
    printf "ERROR: expected exactly one running Zalo bridge container, found %s\n" "$BRIDGE_COUNT" >&2
    exit 1
  fi
  BRIDGE_HEALTH="$("$DOCKER_BIN" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$BRIDGE_CONTAINERS")"
  if [ "$BRIDGE_HEALTH" != "healthy" ]; then
    printf "ERROR: Zalo bridge container %s is %s\n" "$BRIDGE_CONTAINERS" "$BRIDGE_HEALTH" >&2
    exit 1
  fi
  "$DOCKER_BIN" exec "$BRIDGE_CONTAINERS" \
    node -e "require('http').get('http://localhost:18928/health',r=>{r.pipe(process.stdout);process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
  printf "  OK\n"
fi

echo "Done."
