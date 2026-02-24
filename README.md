# heat-tracker

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/m-software-engineering/heat-tracker)
[![npm heat-sdk](https://img.shields.io/npm/v/%40m-software-engineering%2Fheat-sdk)](https://www.npmjs.com/package/@m-software-engineering/heat-sdk)
[![npm heat-collector](https://img.shields.io/npm/v/%40m-software-engineering%2Fheat-collector)](https://www.npmjs.com/package/@m-software-engineering/heat-collector)

Stack completo para heatmaps e replay analítico: SDK Web + coletor HTTP + persistência SQL/Mongo + dashboard de referência.

## Arquitetura do monorepo

- `packages/heat-sdk`: SDK browser que captura eventos (click, move, scroll, pageview, custom e, opcionalmente, input/keyboard).
- `packages/heat-collector`: servidor Express compatível com autenticação por `projectKey`, JWT ou ambos.
- `examples/express-collector`: exemplo mínimo de backend para ingest + query.
- `examples/nextjs-dashboard`: dashboard de referência para renderização de heatmap.

## Fluxo de dados (fim a fim)

1. O front inicializa `@m-software-engineering/heat-sdk` apontando para `/ingest`.
2. O SDK cria lotes de eventos da sessão e envia ao collector.
3. O collector valida payload, autentica, aplica hook opcional e persiste sessão/eventos.
4. O dashboard consulta `/api/projects/:projectId/heatmap`, `/sessions` e `/api/sessions/:sessionId`.

## Setup rápido (desenvolvimento)

### 1) Banco e serviços auxiliares

```bash
docker compose -f examples/docker-compose/docker-compose.yml up -d
```

### 2) Collector de exemplo

```bash
pnpm --filter ./examples/express-collector dev
```

### 3) App frontend com SDK

```ts
import { init } from "@m-software-engineering/heat-sdk";

const tracker = init({
  endpoint: "http://localhost:4000/ingest",
  projectKey: "dev-project-key"
});

tracker.identify("user-123", { plan: "pro" });
tracker.track("cta_click", { source: "hero" });
```

## Integração de backend (Express)

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

## Migração em produção

```bash
HEAT_DIALECT=pg DATABASE_URL=postgres://... heat-collector-migrate
```

## Privacidade por padrão

- Respeita `Do Not Track` por padrão.
- Captura de teclado/input desabilitada por padrão.
- Seletores sensíveis (`password`, OTP, cartão etc.) bloqueados por padrão.

## Scripts úteis

```bash
pnpm build
pnpm test
pnpm test:coverage
pnpm lint
pnpm typecheck
```
