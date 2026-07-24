FROM node:20-bookworm-slim

ARG ZALO_AGENT_VERSION=1.6.2

RUN npm install -g "zalo-agent-cli@${ZALO_AGENT_VERSION}" --omit=dev --no-audit --no-fund \
    && groupadd --system --gid 1001 zalo \
    && useradd --system --uid 1001 --gid zalo --create-home zalo

WORKDIR /app
COPY --chown=zalo:zalo package.json server.js ./

ENV NODE_ENV=production \
    HOME=/home/zalo \
    ZALO_AGENT_EXECUTABLE=/usr/local/bin/zalo-agent \
    ZALO_AGENT_VERSION=${ZALO_AGENT_VERSION}

USER zalo

EXPOSE 18928 18929

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:18928/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
