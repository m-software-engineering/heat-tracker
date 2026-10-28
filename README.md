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
2. `docker compose -f docker-compose.yml -f compose.dev.yml up -d --build` (builds the images from this checkout, then starts Postgres, the collector on port 4000 and the dashboard on port 3000).
3. Copy the admin token from the block printed by `docker compose logs collector`. Show it again any time with `docker compose exec collector heat-collector token`.
4. Open http://localhost:3000 and paste the token once.
5. Copy the snippet into your site. The dashboard shows "Waiting for your first event…" until the first visit arrives, then "Receiving events from <your site>".

> **Images are not published yet.** `docker-compose.yml` pins `ghcr.io/m-software-engineering/heat-collector` and `heat-dashboard` at `0.4.0`, but the pull path (plain `docker compose up -d`, no build) only works after the first release that publishes those images to GHCR. Until then, a plain `docker compose up` fails with `403 Forbidden` / `denied` while pulling. Use the `-f compose.dev.yml` command in step 2.

- Data (Postgres and the admin token) lives in named volumes, so `docker compose down` / `up` keeps it.
- **Full reset:** `docker compose down -v`. **This deletes all recorded data and the admin token.**
- The read API (`/api/*`) needs `Authorization: Bearer <admin token>`. The dashboard keeps the token in an HttpOnly cookie and calls the collector from its server, so the token never reaches browser JavaScript. Ingest stays authenticated by project key.
- If the dashboard says "Can't reach the collector", check `docker compose ps`.

### Settings (`.env` next to `docker-compose.yml`, all optional)

| Variable                       | Default                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HEAT_PUBLIC_COLLECTOR_URL`    | `http://localhost:4000` | Collector URL as visitors' browsers reach it; goes into the snippet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `HEAT_DASHBOARD_URL`           | unset                   | The dashboard's public origin, for example `https://dash.example.com` (http or https, no path or trailing slash; anything else stops the dashboard at startup with `HEAT_E_CONFIG_INVALID`). When set, dashboard login accepts only that exact Origin, and an `https://` value turns on the `Secure` `__Host-heat_admin` cookie. Unset, login trusts `Host`/`X-Forwarded-*`, which is only safe when your proxy overwrites those headers, so set it behind any reverse proxy. The collector's startup block shows it, or `http://localhost:3000` when unset. |
| `HEAT_ADMIN_TOKEN`             | generated               | Fixed admin token (at least 32 characters) instead of the one generated into the volume.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `HEAT_TRUST_PROXY`             | off                     | `true`, a hop count, or addresses/subnets of your reverse proxy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `HEAT_DASHBOARD_SECURE_COOKIE` | `false`                 | `true` forces the `Secure` `__Host-heat_admin` cookie (automatic when the request is HTTPS or `X-Forwarded-Proto: https`).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POSTGRES_PASSWORD`            | `heat`                  | Database password (the database is not published outside the compose network).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`.env` files are excluded from the Docker build context. For TLS, put a reverse proxy in front of ports 3000 and 4000, set `HEAT_PUBLIC_COLLECTOR_URL` to the public collector URL, and forward `Host`/`X-Forwarded-Proto`. **Cookie caveat:** over plain HTTP the cookie is `heat_admin`, and browsers share cookies across ports, so any other app on the same host name (e.g. another service on `localhost:8080`) receives it. Serve the dashboard over HTTPS on its own host name for the `__Host-` cookie.

## Quick setup (local development)

Requires Node.js 22 or newer (CI runs 22 and 24) and pnpm 10. The dev install pulls `better-sqlite3` 13, which does not build on Node 20.

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

Install `cors` (and `@types/cors` for TypeScript) alongside Express. Same idea as NestJS `app.enableCors()`.

```ts
import cors from "cors";
import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const app = express();
// SDK runs in the browser on another origin; match NestJS `app.enableCors()`.
app.use(cors());

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
