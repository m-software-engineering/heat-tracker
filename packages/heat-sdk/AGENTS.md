# heat-sdk Agent Instructions

## Scope
- This file applies to `packages/heat-sdk`.
- Follow the root `AGENTS.md` first; this file adds SDK-specific rules.

## First Read
- Read `packages/heat-sdk/ARCHITECTURE.md` before changing SDK behavior.
- Read the root `ARCHITECTURE.md` to understand SDK and collector interaction.
- Before coding, use `../../.agents/skills/andrej-karpathy-guidelines/SKILL.md`.
- Read `src/index.ts` around the exact feature area before editing.

## Key Surfaces
- `src/index.ts` contains the public API, event types, config defaults, capture engine, queue, storage, privacy gates, listener lifecycle, and fetch transport.
- Storage/session behavior includes project+endpoint namespacing, browser-storage fallback, queue restore/persist, invalid `maxEvents` normalization, and multi-batch flush/shutdown draining.
- Pageview behavior uses a shared History API patch manager so multiple SDK instances can coexist and restore safely.
- `src/index.test.ts` is the focused Vitest/jsdom coverage for SDK behavior.
- `package.json` defines build, test, typecheck, package entrypoints, and the published version.
- Event and payload compatibility must be checked against:
  - `../heat-collector/src/validation.ts`
  - `../heat-collector/src/collector.ts`

## Implementation Rules
- Keep the SDK browser-only; `init` must still fail outside a browser environment.
- Preserve privacy defaults: respect DNT, block sensitive selectors, keep input and keyboard capture disabled by default, and never send raw sensitive values.
- Do not weaken `isSensitiveInput`, selector blocking, allowlist capture behavior, masked input behavior, private move filtering, or metadata sanitization without an explicit product decision.
- Preserve listener cleanup and shared history restoration in `shutdown`, including multiple trackers on the same page.
- Keep queued events, localStorage persistence, storage namespace, retry/backoff, invalid `maxEvents` guardrails, and flush semantics stable unless the task targets them.
- If adding capture config, update `InitConfig`, resolved defaults, event handling, docs, and tests together.
- If adding or changing event types, update the `AnyEvent` union and collector validation/ingest/query behavior in the same change.
- Keep `SDK_VERSION` aligned with `package.json` when the package version changes.

## Verification
- Run `corepack pnpm -C packages/heat-sdk test` for SDK changes.
- Run `corepack pnpm -C packages/heat-sdk typecheck` for TypeScript/API changes.
- Run `corepack pnpm -C packages/heat-sdk build` before changes that affect package output or exports.
- For queue/session/privacy/history changes, add or update tests for micro-frontend-style multiple trackers, storage fallback, allowlist/private selector behavior, multi-batch flush/shutdown, and History API patch restoration.
- If payloads or event contracts change, also run collector tests and root `corepack pnpm test`.
- If browser transport or collector compatibility changes, run root `corepack pnpm test:e2e`.
