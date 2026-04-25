# heat-tracker Monorepo Architecture

## 1) Purpose

`heat-tracker` is an end-to-end product analytics stack that captures browser interaction events in a client SDK, ingests them through an HTTP collector, stores them in SQL/Mongo backends, and exposes query APIs for heatmaps/session analysis and dashboards.

Primary goals observed in code:
- Browser-side event capture with privacy-aware defaults (`packages/heat-sdk`).
- Backend ingestion, validation, auth, persistence, and analytics APIs (`packages/heat-collector`).
- Runnable references for local stack + UI exploration (`examples/*`, `e2e/*`).

## 2) Monorepo map

| Path | Role |
|---|---|
| `packages/heat-sdk` | Browser SDK package (`@m-software-engineering/heat-sdk`). |
| `packages/heat-collector` | Express collector package (`@m-software-engineering/heat-collector`). |
| `examples/express-collector` | Minimal app that mounts collector router. |
| `examples/nextjs-dashboard` | Reference dashboard consuming collector APIs. |
| `examples/docker-compose` | Local infra bootstrap (DB containers). |
| `e2e` | Playwright E2E validating SDK + collector integration. |
| `package.json` | Workspace-level build/test/lint/typecheck commands. |
| `pnpm-workspace.yaml` | Declares workspace packages under `packages/*` and `examples/*`. |

Discovered package roots for architecture docs:
- SDK: `packages/heat-sdk/ARCHITECTURE.md`
- Collector: `packages/heat-collector/ARCHITECTURE.md`

## 3) System architecture

```mermaid
flowchart LR
  Browser[Browser App]
  SDK[@m-software-engineering/heat-sdk]
  Collector[@m-software-engineering/heat-collector\nExpress Router]
  DB[(SQLite / Postgres / MySQL / MongoDB)]
  Dashboard[Dashboard / API Client]

  Browser --> SDK
  SDK -->|POST /ingest| Collector
  Collector --> DB
  Dashboard -->|GET /api/...| Collector
  Collector --> Dashboard
```

Component responsibilities:
- **SDK**: capture click/move/scroll/pageview/custom (+ optional input/keyboard), batch, retry/backoff, flush, and send payloads.
- **Collector**: validate payload/query schemas, enforce auth/rate limits, write project/user/session/event rows, expose query endpoints and metrics.
- **Storage**: adapter pattern for SQL dialects and MongoDB.

## 4) Package relationships

- Dependency direction: `heat-sdk` is independent and publishes payloads over HTTP; `heat-collector` consumes those payload contracts via runtime validation (Zod). There is no direct package import from collector to SDK.
- Coupling boundary: the ingestion payload schema and event type semantics (`click`, `move`, `scroll`, etc.) are the primary contract.
- Integration appears intentionally loose (HTTP + schema), but schema drift risk exists because event types are duplicated between packages rather than centrally shared.

## 5) Data/control flow

```mermaid
sequenceDiagram
  participant U as User in Browser
  participant S as heat-sdk
  participant C as heat-collector
  participant D as DB

  U->>S: Interactions (click/move/scroll/page/input/keyboard)
  S->>S: Queue + batch + metadata enrich
  S->>C: POST /ingest (x-project-key, optional Bearer JWT)
  C->>C: Auth + rate limit + Zod validation
  C->>D: Upsert project/user/session + insert event rows
  C-->>S: 200 OK / error
  Note over S: Backoff and retry on failure

  participant Q as Dashboard/API client
  Q->>C: GET /api/projects/:id/heatmap|events|sessions
  C->>D: Query/filter/aggregate
  C-->>Q: JSON results + metadata headers
```

## 6) Build and execution model

Workspace-level commands:
- `pnpm build`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:e2e`

Package-level highlights:
- SDK and collector both use `tsup` for build and `vitest` for tests.
- Collector CLI binary: `heat-collector-migrate` (runs `autoMigrate` with env-based dialect/connection).

## 7) Patterns

- **Router composition**: collector returns `router`, `ingestRouter`, `apiRouter` for embedding flexibility.
- **Adapter-based persistence**: `createDb` and dialect-specific schema/migration paths.
- **Runtime schema validation**: ingestion and query validation via Zod.
- **Operational metadata**: request IDs, structured logs, consistent error payloads, no-store headers.
- **Privacy-by-default capture**: SDK DNT respect + sensitive selector/input guards.
- **Resilience**: SDK queue persistence option + exponential backoff; collector rate limiting.

## 8) Anti-patterns and risks

Concrete, source-based concerns:
- **Large single-module collector**: `packages/heat-collector/src/collector.ts` combines routing, auth, persistence orchestration, querying, and heatmap aggregation in one file, increasing change risk and cognitive load.
- **In-memory rate limit store** (`rateBuckets` map in process memory): not distributed-safe; resets on restart.
- **Potential N+1 session counting**: `listSessions` computes event counts per session via repeated queries.
- **Dynamic `require` in schema module**: mixed module-loading style (`require(...)` inside TypeScript ESM context) may be brittle in some toolchains.
- **No real linting**: both packages set `lint` script to echo placeholder, so style/static issues can slip through.
- **Contract duplication**: SDK event definitions and collector validation/event handling are maintained separately, creating drift risk.

## 9) Coding-agent guidance

Before changing behavior:
1. Read package docs: `packages/heat-sdk/ARCHITECTURE.md` and `packages/heat-collector/ARCHITECTURE.md`.
2. Verify payload contract alignment across:
   - `packages/heat-sdk/src/index.ts`
   - `packages/heat-collector/src/validation.ts`
   - `packages/heat-collector/src/collector.ts`
3. For DB-impacting changes, inspect:
   - `packages/heat-collector/src/schema.ts`
   - `packages/heat-collector/src/db.ts`
   - collector tests + mongodb tests.
4. Run minimum validation:
   - unit tests for touched package(s), then root `pnpm test` when feasible.

Safe extension points:
- SDK: add event capture toggles/metadata in `InitConfig` + `TrackerImpl` handlers.
- Collector: add endpoints in `apiRouter`; extend query schemas in `validation.ts`.
- DB: extend `events.metaJson` usage for additive metadata with lower migration overhead.

Risky zones:
- `collector.ts` (cross-cutting logic density).
- session lifecycle + queue persistence semantics in SDK.
- auth/rate-limit/error-header behavior relied on by tests/clients.

## 10) Open questions

1. Should event contract types be extracted to a shared package to reduce drift?
2. Should rate limiting move to pluggable/distributed storage for multi-instance deployments?
3. Are there formal retention policies/PII guarantees beyond current defaults and best-effort masking?
