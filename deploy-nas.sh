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

echo "== Workshop Check-in deploy =="
echo "Project: $(pwd)"
echo "Docker: $($DOCKER_BIN --version)"
echo "Compose: $($DOCKER_BIN compose version)"

echo "[1/5] Validate compose"
"$DOCKER_BIN" compose config >/dev/null

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

echo "[4/5] Recreate containers"
"$DOCKER_BIN" compose up -d --force-recreate

echo "[5/5] Wait for health"
sleep 8
"$DOCKER_BIN" compose ps

if command -v curl >/dev/null 2>&1; then
  printf "%s\n" "- App root: $HEALTH_URL/"
  curl -fsS "$HEALTH_URL/" >/dev/null && printf "  OK\n" || printf "  WARN: app root not ready\n"
  printf "\n%s\n" "- API health: $HEALTH_URL/api/health"
  curl -fsS "$HEALTH_URL/api/health" && printf "\n"
fi

echo "Done."
