# heat-tracker

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/m-software-engineering/heat-tracker)
[![npm heat-sdk](https://img.shields.io/npm/v/%40m-software-engineering%2Fheat-sdk)](https://www.npmjs.com/package/@m-software-engineering/heat-sdk)
[![npm heat-collector](https://img.shields.io/npm/v/%40m-software-engineering%2Fheat-collector)](https://www.npmjs.com/package/@m-software-engineering/heat-collector)

End-to-end stack for product analytics heatmaps and session analysis: browser SDK + HTTP collector + SQL/Mongo persistence + dashboard reference app.

## Monorepo structure

- `packages/heat-sdk`: Browser SDK that captures click/move/scroll/pageview/custom events (with optional input/keyboard capture).
- `packages/heat-collector`: Express collector with project key and/or JWT authentication, ingestion, and query APIs.
- `examples/express-collector`: Minimal backend example for ingestion and querying.
- `examples/nextjs-dashboard`: Reference dashboard for heatmap and session exploration.

## How it works

1. Your frontend initializes `@m-software-engineering/heat-sdk` and points it to `/ingest`.
2. The SDK batches session events and sends them to the collector.
3. The collector validates/authenticates payloads and persists projects, users, sessions, and events.
4. The dashboard (or your own UI) reads analytics through query endpoints:
   - `GET /api/projects/:projectId/heatmap`
   - `GET /api/projects/:projectId/events`
   - `GET /api/projects/:projectId/sessions`
   - `GET /api/sessions/:sessionId`

## Quick start (self-hosted, Docker)

1. `git clone https://github.com/m-software-engineering/heat-tracker.git && cd heat-tracker`
2. `docker compose up -d` (Postgres, collector on port 4000, dashboard on port 3000).
3. Copy the admin token from the block printed by `docker compose logs collector`. Show it again any time with `docker compose exec collector heat-collector token`.
4. Open http://localhost:3000 and paste the token once.
5. Copy the snippet into your site. The dashboard shows "Waiting for your first event…" until the first visit arrives, then "Receiving events from <your site>".

> The images are pulled from `ghcr.io/m-software-engineering` at a pinned version. To build them from this checkout instead: `docker compose -f docker-compose.yml -f compose.dev.yml up --build`.

- Data (Postgres and the admin token) lives in named volumes, so `docker compose down` / `up` keeps it.
- **Full reset:** `docker compose down -v`. **This deletes all recorded data and the admin token.**
- The read API (`/api/*`) needs `Authorization: Bearer <admin token>`. The dashboard keeps the token in an HttpOnly cookie and calls the collector from its server, so the token never reaches browser JavaScript. Ingest stays authenticated by project key.
- For TLS, put a reverse proxy in front of ports 3000 and 4000, and set `HEAT_PUBLIC_COLLECTOR_URL` (collector and dashboard) to the public collector URL.
- If the dashboard says "Can't reach the collector", check `docker compose ps`.

## Quick setup (local development)

### 1) Start local infrastructure

```bash
docker compose -f examples/docker-compose/docker-compose.yml up -d
```

### 2) Run the collector example

```bash
pnpm --filter ./examples/express-collector dev
```

### 3) Initialize SDK in your frontend

```ts
import { init } from "@m-software-engineering/heat-sdk";

const tracker = init({
  endpoint: "http://localhost:4000/ingest",
  projectKey: "dev-project-key"
});

tracker.identify("user-123", { plan: "pro" });
tracker.track("cta_click", { source: "hero" });
```

## Collector integration (Express)

```ts
import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const app = express();
const collector = await createCollector({
  db: { dialect: "sqlite", file: "./heat.db" },
  auth: { mode: "projectKey" },
  autoMigrate: true
});

app.use(collector.router);
app.listen(4000);
```

## Production migration command

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```

## Recent behavior updates

- Heatmap coordinates are now captured in page/document space (client position + scroll offsets), so clicks and move trails remain accurate on long or scrolled pages.
- Heatmap rendering now scales Y projection using observed event depth, which reduces vertical compression when users interact below the initial viewport.
- If `type` is omitted in heatmap queries, the collector keeps backward compatibility (`click` first) and transparently falls back to `all` when needed.

## Privacy defaults

- Respects `Do Not Track` by default.
- Input and keyboard capture are disabled by default.
- Sensitive selectors (`password`, OTP, card fields, etc.) are blocked by default.

## Useful scripts

```bash
pnpm verify
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:coverage
pnpm check:deps
pnpm check:arch
pnpm check:pkg
```
