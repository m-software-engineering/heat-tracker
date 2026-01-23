# heat-tracker

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
  projectKey: "dev-project-key"
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
  autoMigrate: true
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

## Mock Screens (for docs)

**Mock 1 - Heatmap View**

"Modern web analytics dashboard, left sidebar (Projects, Heatmaps, Sessions, Settings), top bar with date range picker and dropdown 'Event: Click'. Main panel shows an ecommerce page screenshot with a heatmap overlay (red/yellow hotspots) concentrated on a 'Buy' button and navigation menu. Right panel shows metrics (Total events, Unique sessions, Top elements). Clean SaaS style, light mode."

**Mock 2 - Session Explorer**

"Dark mode dashboard with sessions table (Session ID, User, First Path, Duration, Events). Clicking a row opens a session detail panel with a vertical timeline of events (click, scroll, input focus) and a small viewport preview. Minimal, technical, clean UI."

**Mock 3 - Privacy Settings**

"Settings screen with sections Auth (Project Key / JWT), Privacy (block selectors, allow selectors, DNT), Capture toggles (click/move/scroll/pageview/inputs/keyboard). Professional UI, card layout, switches, light mode."
