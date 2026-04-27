# heat-collector Agent Instructions

## Scope
- This file applies to `packages/heat-collector`.
- Follow the root `AGENTS.md` first; this file adds collector-specific rules.

## First Read
- Read `packages/heat-collector/ARCHITECTURE.md` before changing collector behavior.
- Read the root `ARCHITECTURE.md` to understand SDK and collector interaction.
- Before coding, use `../../.agents/skills/andrej-karpathy-guidelines/SKILL.md`.
- Inspect the relevant route, validation, and storage paths before editing.

## Key Surfaces
- `src/collector.ts` owns `createCollector`, routers, auth flow, rate limiting, ingestion, query shaping, heatmap aggregation, metrics, and persistence orchestration.
- `src/validation.ts` defines Zod schemas for ingestion and query contracts.
- `src/db.ts` creates adapters and runs migrations/index setup.
- `src/schema.ts` defines SQL/Mongo collection/table shapes and create-table SQL.
- `src/jwt.ts` verifies RS256 JWTs and caches JWKS keys.
- `src/collector.test.ts` and `src/mongodb.test.ts` cover SQLite and Mongo behavior.

## Implementation Rules
- Preserve route shapes, auth modes, status codes, structured error payloads, request headers, rate-limit headers, no-store headers, metrics, and heatmap metadata unless the task explicitly changes them.
- Keep SQL and MongoDB behavior in parity for ingestion, queries, migrations, and index behavior.
- For persistence changes, update schema creation, migration/index logic, SQL and Mongo code paths, and tests together.
- For API/query changes, update validation schemas, route handling, response metadata, README/docs, and tests together.
- For event or ingestion payload changes, check SDK compatibility in `../heat-sdk/src/index.ts`.
- Be careful in `collector.ts`; it is cross-cutting and high-risk, so prefer small localized edits.
- Do not log secrets, JWTs, raw request bodies, raw input values, or unsanitized sensitive metadata.
- Keep `heat-collector-migrate` behavior compatible with existing environment variables unless explicitly changed.

## Verification
- Run `corepack pnpm -C packages/heat-collector test` for collector changes.
- Run `corepack pnpm -C packages/heat-collector typecheck` for TypeScript/API changes.
- Run `corepack pnpm -C packages/heat-collector build` before changes that affect exports, CLI, or package output.
- If SDK compatibility, ingestion, transport, or dashboard-facing query behavior changes, run root `corepack pnpm test`.
- If browser-to-collector behavior changes, run root `corepack pnpm test:e2e`.
