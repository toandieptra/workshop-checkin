# syntax=docker/dockerfile:1.6
# ──────────────────────────────────────────────────────────────────
# Frontend (Next.js 14 standalone) — production image
# ──────────────────────────────────────────────────────────────────

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

FROM node:20-slim AS builder
WORKDIR /app

# These are inlined at build time (NEXT_PUBLIC_*) so the JS bundle
# can talk to the right backend without a server-side runtime env.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG BACKEND_INTERNAL_URL=http://backend:8427
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

# Admin auth — đọc ở runtime (KHÔNG prefix NEXT_PUBLIC_), nên chỉ cần ARG
# để build-time fail-fast nếu thiếu, không ENV inline vào image.
ARG ADMIN_PASSWORD
ARG ADMIN_SESSION_SECRET

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build standalone output. After this step:
#   .next/standalone/  → minimal Node server + node_modules
#   .next/static/      → hashed client assets (NOT copied by standalone)
#   public/            → static assets (must be copied manually)
RUN npm run build

# Non-root runtime user
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4317 \
    HOSTNAME=0.0.0.0

# Create a non-root user for the runtime
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p .next/static public

# Public assets (icons, models, etc.). Falls back to no-op if folder is empty.
COPY --from=builder --chown=nextjs:nodejs /app/public/ ./public/

# Standalone server bundle
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/ ./

# ⚠️ CRITICAL: Next.js standalone does NOT auto-include .next/static.
# Without this, the page renders but JS chunks return 404 and the
# client-side hydration never runs → AdminGate stuck at "Đang kiểm tra…".
COPY --from=builder --chown=nextjs:nodejs /app/.next/static/ ./.next/static/

USER nextjs

EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4317/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
