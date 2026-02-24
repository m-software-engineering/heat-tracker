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
   - `GET /api/projects/:projectId/sessions`
   - `GET /api/sessions/:sessionId`

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

## Privacy defaults

- Respects `Do Not Track` by default.
- Input and keyboard capture are disabled by default.
- Sensitive selectors (`password`, OTP, card fields, etc.) are blocked by default.

## Useful scripts

```bash
pnpm build
pnpm test
pnpm test:coverage
pnpm lint
pnpm typecheck
```
