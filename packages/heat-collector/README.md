# @m-software-engineering/heat-collector

Express collector service for heat-tracker. It provides ingestion and query APIs, supports SQL/MongoDB backends, and can authenticate by project key, JWT, or both.

## Install

```bash
npm install @m-software-engineering/heat-collector
# or
pnpm add @m-software-engineering/heat-collector
# or
yarn add @m-software-engineering/heat-collector
```

## Database drivers (peer dependencies)

- Postgres: `pg`
- MySQL: `mysql2`
- SQLite: `better-sqlite3`
- MongoDB: `mongodb`

## Quick start (Express)

```ts
import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const collector = await createCollector({
  db: { dialect: "sqlite", file: "./heat-tracker.db" },
  auth: { mode: "projectKey" },
  autoMigrate: true
});

const app = express();
app.use(collector.router);
// ...your own routes, including under /api...
// Optional: JSON 404 { error: HeatError } with code HEAT_E_ROUTE_NOT_FOUND. Mount it last.
app.use(collector.notFoundHandler);

app.listen(3000, () => {
  console.log("Collector listening on http://localhost:3000");
});
```

## Quick start (NestJS)

Register `collector.router` in `main.ts` after creating the Nest application:

```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createCollector } from "@m-software-engineering/heat-collector";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors();

  const collector = await createCollector({
    db: { dialect: "sqlite", file: "./heat.db" },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });

  app.use(collector.router);

  await app.listen(3000, "0.0.0.0");
}

bootstrap();
```

## How the collector works

1. `POST /ingest` receives event batches from the SDK.
2. The request is authenticated via `x-project-key`, JWT, or both.
3. The collector upserts project/user/session data and stores events.
4. Query APIs return aggregated points and session timelines for dashboards.

## Endpoints

### Ingestion

`POST /ingest`

Accepted headers:

- `x-project-key`: required for `projectKey` and `both` modes.
- `authorization: Bearer <jwt>`: required for `jwt`, optional for `both`.

### Query APIs

- `GET /api/projects?limit&cursor`: every project with `projectKey`, `eventsLast24h`, `lastEventAt` and `receivingData`;
  projects with no events first, then by most recent event.
- `GET /api/projects/:projectId/pages?from&to&limit&cursor`: pages with at least one pageview in the window
  (default last 7 days), sorted by distinct pageview `sessions` then path, with `clicks` and the latest-seen
  `title` (the path when none was sent; `hasTitle: false`). Unknown project: 404 `HEAT_E_PROJECT_NOT_FOUND`.
- Both list endpoints page with `meta.nextCursor` (send it back as `cursor`); `limit` defaults to 50 and is
  clamped to 200 (the applied value is `meta.limit`). An unknown cursor is 400 `HEAT_E_QUERY_CURSOR`.
- Stored paths never keep a query key whose name, lowercased with `-` and `_` removed, contains `token`, `key`, `secret`, `password`, `passwd`, `auth`, `sig`, `jwt`, `session` or `code` (e.g. `access_token`, `api_key`, `X-Amz-Signature`; rare false positives accepted), or whose value looks like an email (also in a `#a=b` fragment), and email-looking path segments become `[email]`.
  This runs on every ingest, with no opt-in.
- `GET /api/projects/:projectId/heatmap`
- `GET /api/projects/:projectId/events`
- `GET /api/projects/:projectId/sessions`
- `GET /api/projects/by-key/:projectKey` (`{ project: { id, name, createdAt } | null }`; `null` until the first event for that key arrives)
- `GET /api/sessions/:sessionId`
- `GET /api/metrics`

With `admin: { token }` in the config, every `/api/*` route requires `Authorization: Bearer <token>` and answers 401 `HEAT_E_ADMIN_TOKEN_MISSING` or `HEAT_E_ADMIN_TOKEN_INVALID` otherwise. Without it the read API stays open, as before. A project is created by the first ingest for its key and named after the request's `Origin` (or `Default`).

### Health

`GET /healthz` → `200 { "ok": true }` while the process is up. It does not touch the database.

### Response headers and error payloads

All endpoints now include:

- `X-Request-Id`: request correlation id for logs/troubleshooting.
- `X-Heat-Collector`: static collector identifier.

Query endpoints also send:

- `Cache-Control: no-store`
- `X-Total-Count` or endpoint-specific count headers.

Error payload format is consistent across routes (full catalog: [docs/errors.md](../../docs/errors.md)):

```json
{
  "error": {
    "code": "HEAT_E_QUERY_INVALID",
    "message": "A query parameter is invalid.",
    "cause": "resolution: received \"1\" (Number must be greater than or equal to 8)",
    "fix": "Correct the parameters listed in details.fieldErrors.",
    "docs": "https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md#heat_e_query_invalid",
    "status": 400,
    "requestId": "...",
    "details": { "fieldErrors": { "resolution": "Number must be greater than or equal to 8" } }
  },
  "code": "invalid_query",
  "message": "A query parameter is invalid.",
  "requestId": "...",
  "details": { "fieldErrors": { "resolution": "Number must be greater than or equal to 8" } }
}
```

Top-level `code`, `message`, `requestId`, and `details` are deprecated and will be removed in the next major version; read `error.code`, `error.message`, `error.requestId`, and `error.details` instead. Responses that still carry them send `Deprecation: true` and a `Link` to the [migration section](../../docs/errors.md#migrating-from-legacy-fields), and the collector logs one deprecation warning per process.

**Breaking:** the old top-level `error` string was removed; `error` is now the object.

```js
// before
showToast(body.error); // "invalid jwt"
// after
showToast(body.error.message); // "The JWT has expired."
```

A JWKS download failure now returns HTTP 503 `HEAT_E_AUTH_JWKS_UNAVAILABLE` with `Retry-After: 30` (it used to be 401 `invalid_jwt`).

### Heatmap query behavior notes

- `type` now accepts: `all`, `click`, `move`, `scroll`, `pageview`, `custom`, `input`, `keyboard`.
- If `type` is omitted, the collector first tries `click` (backward compatible) and automatically falls back to `all` when click has no matches.
- Heatmap points are only plotted from `click`, `move`, and `scroll`; other event types still appear in heatmap metadata (`total`, `typeBreakdown`, `warning`) for better debugging.
- The heatmap renderer adapts to deeper page interactions by expanding `meta.renderHeight` beyond the base viewport when events are observed below the fold.
- Aggregation runs in the database (`GROUP BY` on bucketed coordinates; MongoDB aggregation pipelines), so a heatmap over 1 M events stays within p95 ≤ 500 ms on Postgres with constant collector memory. `meta.totalEvents` is the number of matched events and `meta.sampled` is `false` (every matched event is counted).
- Without `from` and `to`, a heatmap covers the last 7 days ending with the current hour; `meta.range` is `{ from, to, defaulted }`. `from` alone ends at now, `to` alone starts at 0.
- `viewport=400x800,400x900` counts only events stored with one of those viewport buckets (the first sets the grid). `meta.viewportBuckets` lists `{ bucket, count }` for every bucket in the range, ignoring `viewport`.
- `click`/`move` events without coordinates (and scrolls without depth) are skipped on every database and counted in `meta.excluded.noCoordinates`. SQL databases used to plot them at 0,0.
- Whole hours are read from the `heatmap_rollup` table, which ingest keeps up to date and `autoMigrate` builds from existing events (MongoDB reads events directly).
- Without `viewportBucket`, the viewport is the most common bucket among the 10,000 most recent matching events. `viewportBucket` must look like `1440x900`; anything else returns 400 `HEAT_E_QUERY_INVALID` naming the param.
- `autoMigrate` adds the `events_project_path_type_ts_idx` index (project, path, type, ts), the `events.viewport_bucket` and `events.rollup_state` columns and the `heatmap_rollup` table, and counts older rows into it (safe to run while ingesting, and on several instances at once).
- Rolling upgrades: an older collector still running next to an upgraded one writes events without counting them (`rollup_state` stays NULL). Before a heatmap read, the collector counts up to 10,000 such rows for that project; if more remain, it reads the whole range from raw events instead, so results stay correct. A background catch-up (`heatmap.rollupCatchUpIntervalMs`, default 60000, `0` disables) counts the rest. Call `collector.close()` to stop it.
- Scroll events are projected vertically from scroll depth percentage into the active render height, so scroll hotspots line up better with long-page behavior.

## Configuration

```ts
type CollectorConfig = {
  db:
    | { dialect: "pg" | "mysql" | "sqlite"; connectionString?: string; file?: string }
    | { dialect: "mongodb"; connectionString?: string; database?: string };
  auth:
    | { mode: "projectKey" }
    | { mode: "jwt"; jwksUrl: string; issuer: string; audience: string }
    | { mode: "both"; jwksUrl: string; issuer: string; audience: string };
  autoMigrate?: boolean;
  ingestion?: {
    maxBodyBytes?: number;
    rateLimit?: { windowMs: number; max: number };
  };
  hooks?: {
    onBeforeInsert?: (payload: any) => any | Promise<any>;
  };
  logging?: { level: "debug" | "info" | "warn" | "error" };
};
```

## MongoDB permissions note

When `autoMigrate` is enabled, the collector attempts to create indexes. If the MongoDB user does not have index-management permissions, the collector now continues without failing startup. For controlled production environments, you can still set `autoMigrate: false` and manage indexes externally.

### Troubleshooting `not authorized on <db> to execute command { find: "projects" }`

This error usually means the collector is querying a different database than the one your MongoDB user can access.

Use one of these options:

1. Put the database directly in the connection string path:

```ts
db: {
  dialect: "mongodb",
  connectionString: "mongodb://user:password@host:27017/heat_tracker?authSource=admin"
}
```

2. Or explicitly set `database` in the collector config:

```ts
db: {
  dialect: "mongodb",
  connectionString: "mongodb://user:password@host:27017/?authSource=admin",
  database: "heat_tracker"
}
```

The collector now prefers `db.database` when provided, otherwise it uses the database from the MongoDB connection string.

## Standalone server (`heat-collector`)

The package ships a ready-to-run server, used by the Docker images:

```bash
DATABASE_URL=postgres://heat:heat@localhost:5432/heat_tracker HEAT_DATA_DIR=./data heat-collector
heat-collector token   # prints the admin token again
```

| Variable           | Default            | Meaning                                                                                                                               |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `HEAT_DIALECT`     | `pg`               | `pg`, `mysql`, `mongodb` or `sqlite` (`SQLITE_FILE`).                                                                                 |
| `DATABASE_URL`     | —                  | Required except for SQLite; missing → `HEAT_E_DB_CONFIG`, unreachable → `HEAT_E_DB_UNREACHABLE` (host:port only, never the password). |
| `HEAT_DATA_DIR`    | `/data`            | Where the generated admin token is stored (`admin-token`, mode 0600).                                                                 |
| `HEAT_ADMIN_TOKEN` | —                  | Use this token instead of the stored one.                                                                                             |
| `PORT` / `HOST`    | `4000` / `0.0.0.0` | Listen address.                                                                                                                       |
| `HEAT_LOG_LEVEL`   | `warn`             | Request logs appear at `info`.                                                                                                        |
| `HEAT_TRUST_PROXY` | —                  | Express `trust proxy` value when behind a reverse proxy.                                                                              |

A database host that does not resolve fails with `HEAT_E_DB_UNREACHABLE` naming `ENOTFOUND`. A dropped idle Postgres connection (database restart) is logged as `HEAT_E_DB_CONNECTION_LOST` and the pool reconnects on the next query; the process keeps running. An empty `admin-token` file fails with `HEAT_E_ADMIN_TOKEN_FILE_INVALID` (delete it to regenerate).

At startup it prints one block with the dashboard URL, the admin token, and the command to show it again. `/ingest` answers CORS preflights from any origin (ingest stays authenticated by project key); the read API sends no CORS headers.

## Production migration command

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```
