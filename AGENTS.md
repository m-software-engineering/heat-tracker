# Coding Agent Instructions

## Scope
- This file applies to the whole `heat-tracker` pnpm workspace.
- Package-level `AGENTS.md` files add rules for their package subtrees.
- Keep changes focused on the requested feature or fix.

## First Read
- Before changing behavior, read `ARCHITECTURE.md`.
- If touching a package, also read that package's `ARCHITECTURE.md`.
- Before coding, use `.agents/skills/andrej-karpathy-guidelines/SKILL.md`.
- Apply that skill's rules: surface assumptions, choose the simplest working change, edit surgically, and verify with concrete checks.

## Repository Map
- `packages/heat-sdk`: browser SDK for capture, batching, privacy gates, and ingestion transport.
- `packages/heat-collector`: Express collector for auth, validation, persistence, query APIs, metrics, and migrations.
- `examples/express-collector`: local collector host used for quick manual validation.
- `examples/nextjs-dashboard`: reference dashboard that consumes collector query APIs.
- `examples/docker-compose`: local MySQL/Postgres services for adapter work.
- `e2e`: Playwright integration coverage for SDK and collector round trips.

## Change Rules
- Prefer existing patterns, TypeScript style, package scripts, and local helper APIs.
- Do not perform speculative refactors or unrelated cleanup.
- Preserve user changes; never revert work you did not make unless explicitly asked.
- Avoid editing generated output such as `dist`, coverage, caches, or local database files.
- Keep public APIs, package exports, endpoint shapes, payload formats, and response headers backward compatible unless the task explicitly changes them.
- For event or ingestion payload changes, keep these files aligned:
  - `packages/heat-sdk/src/index.ts`
  - `packages/heat-collector/src/validation.ts`
  - `packages/heat-collector/src/collector.ts`
- If public behavior changes, update relevant README, changelog, architecture, package tests, and e2e coverage as appropriate.

## Verification
- For package-only work, start with the touched package's tests, typecheck, and build.
- Run `corepack pnpm typecheck` before broad TypeScript changes.
- Run `corepack pnpm test` when behavior crosses package boundaries.
- Run `corepack pnpm test:e2e` when SDK-to-collector integration, transport, ingestion, or query behavior changes.
- `corepack pnpm lint` currently runs placeholder scripts in the packages; do not treat it as a substitute for tests and typecheck.
