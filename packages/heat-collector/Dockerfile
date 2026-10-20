# syntax=docker/dockerfile:1
# heat-collector server image. Build context: repository root.
#   docker build -f packages/heat-collector/Dockerfile -t heat-collector .
# The runtime stage holds one bundled file (scripts/bundle-server.mjs): no node_modules, no shell
# tools beyond busybox, runs as the unprivileged `node` user, and keeps the admin token in /data.

FROM node:22.23.0-bookworm-slim AS build
ENV COREPACK_HOME=/corepack CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm -C packages/heat-errors build \
  && cd packages/heat-collector && node scripts/bundle-server.mjs /out

FROM node:22.23.0-alpine AS runtime
ENV NODE_ENV=production PORT=4000 HEAT_DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/server.cjs /app/server.cjs
RUN printf '#!/bin/sh\nexec node /app/server.cjs "$@"\n' > /usr/local/bin/heat-collector \
  && chmod 0755 /usr/local/bin/heat-collector \
  && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null || exit 1
CMD ["heat-collector"]
