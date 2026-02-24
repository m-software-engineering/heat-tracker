# @m-software-engineering/heat-collector

Collector server do heat-tracker. Expõe rotas de ingestão e consulta, com persistência em Postgres, MySQL, SQLite ou MongoDB.

## Instalação

```bash
npm install @m-software-engineering/heat-collector
# ou
pnpm add @m-software-engineering/heat-collector
# ou
yarn add @m-software-engineering/heat-collector
```

### Drivers de banco (peer dependencies)

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

## Setup NestJS (forma validada em produção)

> Relatos de integração mostraram que a forma mais estável é registrar o `collector.router` diretamente no `main.ts` após criar a app Nest.

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

## Endpoints

### Ingest

`POST /ingest`

Headers aceitos:

- `x-project-key`: chave do projeto (obrigatória em `projectKey`/`both`)
- `authorization: Bearer <jwt>`: obrigatório em `jwt`, opcional em `both`

### Query APIs

- `GET /api/projects/:projectId/heatmap`
- `GET /api/projects/:projectId/sessions`
- `GET /api/sessions/:sessionId`
- `GET /api/metrics`

## Configuração

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

## Migrations em produção

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```
