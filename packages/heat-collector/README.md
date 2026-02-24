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
- `GET /api/projects/:projectId/sessions`
- `GET /api/sessions/:sessionId`
- `GET /api/metrics`

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

## Production migration command

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```
