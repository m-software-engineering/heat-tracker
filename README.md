# heat-tracker

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/m-software-engineering/heat-tracker)

Full heatmap tracking stack: a browser SDK + Node collector + SQL persistence + reference dashboards.

## Packages

- `@m-software-engineering/heat-sdk` - Browser SDK
- `@m-software-engineering/heat-collector` - Collector server

## Quickstart (Backend - 5 minutes)

1. Start a DB with Docker:

```bash
docker compose -f examples/docker-compose/docker-compose.yml up -d
```

2. Run the example collector (SQLite by default):

```bash
pnpm --filter ./examples/express-collector dev
```

3. Point the SDK to `http://localhost:4000/ingest` with your project key.

## Quickstart (Frontend - 2 minutes)

```ts
import { init } from "@m-software-engineering/heat-sdk";

const tracker = init({
  endpoint: "http://localhost:4000/ingest",
  projectKey: "dev-project-key",
});

tracker.identify("user-123", { plan: "pro" });
```

## Collector Integration (5-10 lines)

```ts
import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const app = express();
const collector = await createCollector({
  db: { dialect: "sqlite", file: "./heat.db" },
  auth: { mode: "projectKey" },
  autoMigrate: true,
});

app.use(collector.router);
app.listen(4000);
```

### Production migrations (CLI)

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```

## Example Dashboard

`examples/nextjs-dashboard` is a reference Next.js app that calls the query APIs and renders heatmaps with `heatmap.js`.

## Privacy Defaults

- Do Not Track respected by default.
- Input/keyboard capture is off by default.
- Sensitive input types are blocked even if capture is enabled.
