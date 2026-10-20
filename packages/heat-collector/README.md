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

- `GET /api/projects/:projectId/heatmap`
- `GET /api/projects/:projectId/events`
- `GET /api/projects/:projectId/sessions`
- `GET /api/sessions/:sessionId`
- `GET /api/metrics`

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
- `viewport=390x800` counts only events stored with that viewport bucket (and uses it as the grid). `meta.viewportBuckets` lists `{ bucket, count }` for every bucket in the range, ignoring `viewport`.
- `click`/`move` events without coordinates (and scrolls without depth) are skipped on every database and counted in `meta.excluded.noCoordinates`. SQL databases used to plot them at 0,0.
- Whole hours are read from the `heatmap_rollup` table, which ingest keeps up to date and `autoMigrate` builds from existing events (MongoDB reads events directly).
- Without `viewportBucket`, the viewport is the most common bucket among the 10,000 most recent matching events. `viewportBucket` must look like `1440x900`; anything else returns 400 `HEAT_E_QUERY_INVALID` naming the param.
- `autoMigrate` adds the `events_project_path_type_ts_idx` index (project, path, type, ts), the `events.viewport_bucket` and `events.rollup_state` columns and the `heatmap_rollup` table, and counts older rows into it (safe to run while ingesting, and on several instances at once).
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

## Production migration command

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```
