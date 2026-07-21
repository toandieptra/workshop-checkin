#!/usr/bin/env sh
# Workshop Check-in deploy script
# - Picks an existing linux/amd64 buildx builder (prefers wsbuilder2 because
#   its BuildKit container is already running).
# - Builds each service as linux/amd64 via buildx --load so images land in
#   the local docker daemon (avoids the docker buildx "no export" issue).
# - Tags built images as :latest only (no :amd64 intermediate tags).
# - Force-recreates containers and verifies health endpoints.
set -eu

cd "$(dirname "$0")"

DOCKER_BIN="${DOCKER_BIN:-/usr/local/bin/docker}"
APP_URL="${APP_URL:-https://workshop.hisweetievietnam.com}"
FACE_URL="${FACE_URL:-http://192.168.1.201:8428}"
GATEWAY_FACE_URL="${GATEWAY_FACE_URL:-http://192.168.1.201:8087/face-api}"

if [ ! -x "$DOCKER_BIN" ]; then
  if command -v docker >/dev/null 2>&1; then
    DOCKER_BIN="$(command -v docker)"
  else
    echo "ERROR: docker not found. Set DOCKER_BIN=/path/to/docker" >&2
    exit 1
  fi
fi

echo "== Workshop Check-in deploy =="
echo "Project: $(pwd)"
echo "Docker: $($DOCKER_BIN --version)"
echo "Compose: $($DOCKER_BIN compose version)"

mkdir -p ./postgres-data ./redis-data ./uploads

echo "[1/6] Validate compose"
"$DOCKER_BIN" compose config >/dev/null

echo "[2/6] Pick a running linux/amd64 buildx builder"
PICKED_BUILDER=""
# Prefer wsbuilder2 (container driver with BuildKit v0.12.5 already running).
for cand in wsbuilder2 wsbuilder wsbuilder3 wsbuilder4 default; do
  if "$DOCKER_BIN" buildx inspect "$cand" >/dev/null 2>&1; then
    if "$DOCKER_BIN" buildx inspect "$cand" 2>/dev/null | grep -qE "linux/amd64\*"; then
      PICKED_BUILDER="$cand"
      break
    fi
  fi
done

if [ -z "$PICKED_BUILDER" ]; then
  echo "  No amd64 builder found. Creating 'wsbuilder' with --bootstrap..."
  "$DOCKER_BIN" buildx create --name wsbuilder --driver docker-container \
    --platform linux/amd64 --driver-opt image=moby/buildkit:v0.12.5 \
    --bootstrap >/dev/null
  PICKED_BUILDER=wsbuilder
fi

echo "  Using builder: $PICKED_BUILDER"
"$DOCKER_BIN" buildx use "$PICKED_BUILDER"

echo "[3/6] Build images (linux/amd64, no cache, --pull, --load) -> :latest"
"$DOCKER_BIN" build --no-cache --pull --load --platform=linux/amd64 \
  -t workshop-checkin-backend:latest -f backend/Dockerfile backend

"$DOCKER_BIN" build --no-cache --pull --load --platform=linux/amd64 \
  -t workshop-checkin-face-api:latest -f face-api/Dockerfile face-api

WS_HOST="$(printf %s "$APP_URL" | sed -E 's#^https?://##')"
WS_SCHEME="ws"
case "$APP_URL" in
  https://*) WS_SCHEME="wss" ;;
esac
"$DOCKER_BIN" build --no-cache --pull --load --platform=linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL="$APP_URL/api" \
  --build-arg NEXT_PUBLIC_WS_URL="${WS_SCHEME}://${WS_HOST}/ws" \
  -t workshop-checkin-frontend:latest -f frontend/Dockerfile frontend

echo "[4/6] Recreate containers"
"$DOCKER_BIN" compose up -d --force-recreate
"$DOCKER_BIN" compose exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < migrations/026_zbs_oauth_credentials.sql

echo "[5/6] Current status"
sleep 5
"$DOCKER_BIN" compose ps

echo "[6/6] Health checks"
sleep 5
if command -v curl >/dev/null 2>&1; then
  printf "%s\n" "- App: $APP_URL"
  curl -fsS "$APP_URL" >/dev/null && printf "  OK\n" || printf "  WARN: app root not ready\n"
  printf "\n%s\n" "- API health: $APP_URL/api/health"
  curl -fsS "$APP_URL/api/health" || printf "  WARN: api health failed\n"
  printf "\n%s\n" "- Face API direct: $FACE_URL/health"
  curl -fsS "$FACE_URL/health" || printf "  WARN: face-api direct failed\n"
  printf "\n%s\n" "- Face API via gateway: $GATEWAY_FACE_URL/health"
  curl -fsS "$GATEWAY_FACE_URL/health" || printf "  WARN: face-api via gateway failed\n"
  printf "\n"
else
  echo "curl not found; skip HTTP health checks"
fi

echo "Done. Open: $APP_URL"
echo "Face API direct: $FACE_URL/health"
echo "Face API via gateway: $GATEWAY_FACE_URL/health"
