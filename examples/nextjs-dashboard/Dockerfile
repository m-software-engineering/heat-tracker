# syntax=docker/dockerfile:1
# Reference dashboard image (Next.js standalone server). Build context: repository root.
#   docker build -f examples/nextjs-dashboard/Dockerfile -t heat-dashboard .

FROM node:22.23.0-bookworm-slim AS build
ENV COREPACK_HOME=/corepack CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm -C packages/heat-errors build \
  && pnpm -C examples/nextjs-dashboard build

FROM node:22.23.0-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /repo/examples/nextjs-dashboard/.next/standalone ./
COPY --from=build --chown=root:root /repo/examples/nextjs-dashboard/.next/static ./examples/nextjs-dashboard/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "examples/nextjs-dashboard/server.js"]
