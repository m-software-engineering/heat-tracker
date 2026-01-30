# @m-software-engineering/heat-collector

Collector server for heat-tracker sessions and events. Exposes ingest and query APIs and stores data in your database.

## Install

```bash
npm install @m-software-engineering/heat-collector
# or
pnpm add @m-software-engineering/heat-collector
# or
yarn add @m-software-engineering/heat-collector
```

Database drivers are peer dependencies:
- Postgres: `pg`
- MySQL: `mysql2`
- SQLite: `better-sqlite3`

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

## Framework snippets

### Express (minimal)

```ts
import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const app = express();
const collector = await createCollector({
  db: { dialect: "sqlite", file: "./heat-tracker.db" },
  auth: { mode: "projectKey" }
});

app.use(collector.router);
app.listen(3000);
```

### NestJS (middleware)

```ts
// app.module.ts
import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { createCollector } from "@m-software-engineering/heat-collector";
import express from "express";

@Module({})
export class AppModule implements NestModule {
  async configure(consumer: MiddlewareConsumer) {
    const collector = await createCollector({
      db: { dialect: "sqlite", file: "./heat-tracker.db" },
      auth: { mode: "projectKey" }
    });

    const router = express.Router();
    router.use(collector.router);
    consumer.apply(router).forRoutes("*");
  }
}
```

## Ingest

`POST /ingest`

Headers:
- `x-project-key`: your project key
- `authorization`: `Bearer <jwt>` (optional if using JWT auth)

## Query APIs

- `GET /api/projects/:projectId/heatmap`
- `GET /api/projects/:projectId/sessions`
- `GET /api/sessions/:sessionId`

## Auth modes

- `projectKey`: ingest requires `x-project-key`
- `jwt`: ingest requires a valid JWT
- `both`: accepts both project key and JWT

## Configuration

```ts
type CollectorConfig = {
  db: { dialect: "pg" | "mysql" | "sqlite"; connectionString?: string; file?: string };
  auth:
    | { mode: "projectKey" }
    | { mode: "jwt"; jwksUrl: string; issuer: string; audience: string }
    | { mode: "both"; jwksUrl: string; issuer: string; audience: string };
  autoMigrate?: boolean;
  ingestion?: { maxBodyBytes?: number; rateLimit?: { windowMs: number; max: number } };
  hooks?: { onBeforeInsert?: (payload: any) => any | Promise<any> };
  logging?: { level: "debug" | "info" | "warn" | "error" };
};
```
