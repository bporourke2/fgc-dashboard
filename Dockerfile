# FGC Dashboard: read-only web UI for Free-Games-Claimer-Remaster.
FROM node:24-alpine

ARG VERSION=dev
ARG COMMIT=unknown
LABEL org.opencontainers.image.title="fgc-dashboard" \
      org.opencontainers.image.description="Read-only web dashboard for Free-Games-Claimer-Remaster" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"

ENV NODE_ENV=production \
    PORT=8080 \
    FGC_DATA_DIR=/fgc/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# No npm dependencies to install. Run as the unprivileged "node" user.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "src/server.js"]
