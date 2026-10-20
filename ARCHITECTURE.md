# heat-tracker Monorepo Architecture

## 1) Purpose

`heat-tracker` is an end-to-end product analytics stack that captures browser interaction events in a client SDK, ingests them through an HTTP collector, stores them in SQLite, Postgres, MySQL, or MongoDB, and exposes query APIs for heatmaps/session analysis and dashboards.

Primary goals observed in code:

- Browser-side event capture with privacy-aware defaults (`packages/heat-sdk`).
- Backend ingestion, validation, auth, persistence, and analytics APIs (`packages/heat-collector`).
- Runnable references for local stack + UI exploration (`examples/*`, `e2e/*`).

## 2) Monorepo map

| Path                         | Role                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `packages/heat-sdk`          | Browser SDK package (`@m-software-engineering/heat-sdk`).             |
| `packages/heat-collector`    | Express collector package (`@m-software-engineering/heat-collector`). |
| `packages/heat-errors`       | Zero-dependency `HEAT_E_*` error catalog shared by SDK and collector. |
| `docs/errors.md`             | Error reference generated from the `heat-errors` catalog.             |
| `examples/express-collector` | Minimal app that mounts collector router.                             |
| `examples/nextjs-dashboard`  | Reference dashboard consuming collector APIs.                         |
| `examples/docker-compose`    | Local MySQL/Postgres bootstrap for SQL adapter testing.               |
| `e2e`                        | Playwright E2E validating SDK + collector integration.                |
| `package.json`               | Workspace-level build/test/lint/typecheck commands.                   |
| `pnpm-workspace.yaml`        | Declares workspace packages under `packages/*` and `examples/*`.      |

Discovered package roots for architecture docs:

- SDK: `packages/heat-sdk/ARCHITECTURE.md`
- Collector: `packages/heat-collector/ARCHITECTURE.md`

## 3) System architecture

```mermaid
flowchart LR
  browser["Browser App"]
  sdk["@m-software-engineering/heat-sdk"]
  collector["@m-software-engineering/heat-collector<br/>Express Router"]
  db[(SQLite / Postgres / MySQL / MongoDB)]
  dashboard["Dashboard / API Client"]

  browser --> sdk
  sdk -->|POST /ingest| collector
  collector --> db
  dashboard -->|GET /api/projects/:projectId/...<br/>GET /api/sessions/:sessionId| collector
  collector -->|JSON responses| dashboard
```

Component responsibilities:

- **SDK**: capture click/move/scroll/pageview/custom (+ optional input/keyboard), apply privacy gates, namespace session/queue storage per project+endpoint, batch, retry/backoff, flush, and send payloads.
- **Collector**: assign request IDs before body parsing, validate payload/query schemas, enforce ingest auth/rate limits, write project/user/session/event rows, expose query endpoints and metrics.
- **Storage**: adapter pattern for SQL dialects and MongoDB.

## 4) Package relationships

- Dependency direction: `heat-sdk` is independent and publishes payloads over HTTP; `heat-collector` consumes those payload contracts via runtime validation (Zod). There is no direct package import from collector to SDK.
- Coupling boundary: the ingestion payload schema and event type semantics (`click`, `move`, `scroll`, etc.) are the primary contract.
- Both packages use `@m-software-engineering/heat-errors` (zero runtime deps) for one error shape. The collector depends on it at runtime; the SDK bundles the entries it uses at build time (`tsup.noExternal`), so its browser ESM build stays dependency-free (≈ +1 KB min+gzip). Shape: `{ code: HEAT_E_*, message, cause, fix, docs, requestId?, status?, details? }`. The collector answers `{ error: HeatError }` (the old top-level `error` string is gone). It keeps the deprecated top-level `code`/`message`/`requestId`/`details` until the next major, sends `Deprecation: true` plus a `Link` to `docs/errors.md#migrating-from-legacy-fields` (only on responses that carry the legacy fields), and logs one deprecation warning per process naming each replacement. It cannot see which fields clients read, so it warns on the first error response. `POST /ingest` with a missing or non-JSON Content-Type returns 415. `collector.router` never answers unknown paths, so host routes registered after it (even under `/api`) keep working; hosts opt into a JSON 404 by mounting `collector.notFoundHandler` last. Known follow-up (#49): the SDK still requeues definitive 4xx responses (e.g. 400/401/415) with backoff instead of dropping the batch. The SDK passes collector errors to `onError`. The catalog is split per surface (`sdk`, `ingest`, `query`, `server`) so the SDK only pulls its own entries, and `docs/errors.md` is regenerated with `corepack pnpm -C packages/heat-errors docs:errors` (a unit test fails when it is stale).
- Integration appears intentionally loose (HTTP + schema), but schema drift risk exists because event types are duplicated between packages rather than centrally shared.

## 5) Data/control flow

```mermaid
sequenceDiagram
  participant U as User in Browser
  participant S as heat-sdk
  participant C as heat-collector
  participant D as DB

  U->>S: Interactions (click/move/scroll/page/input/keyboard)
  S->>S: Privacy gates + namespaced queue + metadata enrich
  S->>C: POST /ingest (x-project-key, optional Bearer JWT)
  C->>C: Request ID + JSON parse + project key + rate limit + optional JWT + Zod validation
  C->>D: Upsert project/user/session + insert event rows
  C-->>S: 200 OK / error
  Note over S: Backoff and retry on failure

  participant Q as Dashboard/API client
  Q->>C: GET project heatmap, events, sessions, or session detail
  C->>D: Query/filter/aggregate
  C-->>Q: JSON results + metadata headers
```

## 6) Build and execution model

Workspace-level commands:

- `pnpm verify`
- `pnpm format:check`
- `pnpm build`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:e2e`
- `pnpm check:deps`
- `pnpm check:arch`
- `pnpm check:pkg`

Package-level highlights:

- SDK and collector both use `tsup` for build and `vitest` for tests.
- The collector validates both ESM and CommonJS distribution entrypoints against an in-memory SQLite database after its unit and coverage suites.
- Collector CLI binary: `heat-collector-migrate` (runs `autoMigrate` with env-based dialect/connection).
- The deterministic quality harness is centered on `pnpm verify`, which chains formatting, ESLint, TypeScript, builds, coverage, Playwright, Knip, dependency-cruiser, publint, Are The Types Wrong, and API Extractor.
- The reference dashboard draws the click heatmap over the live page (#27): `components/PageHeatmap.tsx` frames the site (`sandbox="allow-same-origin allow-scripts"`, pointer events off) at the recorded viewport width, inside one scroll container with the canvas, so overlay and page scroll together without drift. Framing is checked server-side by `app/api/frame-check` (`lib/frame-policy.ts`: CSP `frame-ancestors` first, then `X-Frame-Options`), because a blocked cross-origin frame looks the same as an allowed one in the browser; a blocked site shows `HEAT_E_FRAME_BLOCKED` (catalog `DASHBOARD_ERRORS`) and the heatmap on a blank canvas. `lib/heatmap-render.ts` bins points on a ≤ 400 k-cell grid, box-blurs and colors them with a viridis palette in yielding chunks (100 k points ≈ 45 ms, no long task). A "Top clicked areas" table is the text alternative. View choices (viewport, opacity, heatmap on/off, table, period) live in the URL. `e2e/heatmap-overlay.e2e.spec.ts` mounts the component without Next.js (tsup bundle) against a real collector and a cross-origin site, and also covers alignment, the blocked state, the render budget and axe. The frame-check route only fetches origins allowlisted in `HEAT_DASHBOARD_SITE_ORIGINS` (2.5 s timeout, headers only), so it cannot be used as an open SSRF proxy; other origins are never framed and show `HEAT_E_FRAME_ORIGIN_NOT_ALLOWED` with the allowlist line to copy. The viewport toggle sends the collector's `viewport` filter (busiest stored bucket of the class, from `meta.viewportBuckets`), and the frame scales down to fit narrow containers.
- `.github/workflows/heatmap-db.yml` runs the heatmap golden test on real Postgres, MySQL and MongoDB plus the 1 M-event Postgres bench (p95 ≤ 500 ms, flat RSS), nightly and on PRs touching the heatmap query.
- GitHub Actions separates PR verification from release publishing: `ci.yml` runs full `pnpm verify` on Node 22 and `pnpm verify:non-e2e` on Node 24 for pull requests, while `cd.yml` runs the Changesets release flow only on pushes to `main` after merges. CI preinstalls Chromium only for the Node 22 browser job because the Playwright suite targets Chromium, emits one aggregate Markdown quality summary from uploaded artifacts, and CodeQL remains handled by GitHub default setup so the repository does not upload duplicate advanced-setup CodeQL SARIF. CD uses npm trusted publishing with short-lived GitHub OIDC credentials instead of a long-lived registry token, and emits a Markdown release summary from Changesets outputs and package manifests. Published package manifests declare the monorepo and their workspace directory so npm can verify the workflow identity.
- Security workflows pin executable actions to immutable commits. Semgrep scans the full repository, pnpm applies minimum-release-age, exotic-subdependency, and trust-policy safeguards, and the scheduled OSV scan pins its scanner release because upstream does not publish a floating `v2` action ref. OSV findings are uploaded as SARIF after scanner failures via `if: !cancelled()`, while the scanner's exit status now fails the job instead of being suppressed. Production manifests require patched Next.js, Drizzle ORM, MySQL2, and Express releases, while major-line-scoped pnpm overrides prevent vulnerable PostCSS 8.x, `path-to-regexp` 0.1.x, and `qs` 6.x resolutions without coercing incompatible major lines. The workspace uses pnpm 10.26.0, the first release that supports all three package-install safeguards, and explicitly allows install scripts only for `better-sqlite3`, `esbuild`, and `unrs-resolver`, which require native or platform-specific binaries.
- Development tooling requires the patched Vitest 4.1 line with its matching V8 coverage provider. Narrow package-version overrides keep vulnerable lockfile-only releases of brace-expansion, fast-uri, flatted, form-data, glob, js-yaml, minimatch, picomatch, proxy-addr, Rollup, sharp, smol-toml, source-map-js, and ws out of the graph, while Vitest selects the maintainer-supported Vite 6.4 line because Vite 5 has no patched release for the active advisories.
- The Next.js dashboard example requires Next.js 15.5.27 or newer. Advisories with no patched release are recorded in the root `osv-scanner.toml`, which the recursive OSV scan loads automatically; each entry names the dev-only dependency path, explains why it is not shipped, and sets an `ignoreUntil` expiry so it is re-reviewed. It currently covers braces 3.0.3 (via `@changesets/cli` 2.x micromatch) and sprintf-js 1.0.3 (via `@microsoft/api-extractor` argparse 1.x).

## 7) Patterns

- **Router composition**: collector returns `router`, `ingestRouter`, `apiRouter` for embedding flexibility.
- **Adapter-based persistence**: `createDb` and dialect-specific schema/migration paths.
- **Runtime schema validation**: ingestion and query validation via Zod.
- **Hook safety**: `hooks.onBeforeInsert` output is revalidated before persistence.
- **Operational metadata**: request IDs, structured logs, consistent error payloads, no-store headers.
- **Privacy-by-default capture**: SDK DNT respect, sensitive selector/input guards, allowlist modes that capture nothing without selectors, and private-target move filtering.
- **Resilience**: SDK storage fallback, namespaced queue persistence, multi-batch flush/shutdown draining, exponential backoff, and per-collector-instance rate limiting with bucket pruning.

## 8) Anti-patterns and risks

Concrete, source-based concerns:

- **Large single-module collector**: `packages/heat-collector/src/collector.ts` combines routing, auth, persistence orchestration, and querying in one file, increasing change risk and cognitive load. Heatmap aggregation now lives in `src/heatmap*.ts` and runs in the database (grouped queries, no raw rows in Node); whole hours read the `heatmap_rollup` table maintained at ingest.
- **In-memory rate limit store**: buckets are scoped per collector instance and pruned, but are still process-local, not distributed-safe, and reset on restart.
- **Potential N+1 session counting**: `listSessions` computes event counts per session via repeated queries.
- **Multi-dialect schema loading**: Drizzle dialect-core modules are imported statically so the published ESM entrypoint remains executable; optional database drivers are still loaded only for the configured adapter.
- **Unauthenticated query APIs by default**: project heatmap/events/sessions routes preserve existing compatibility and should be protected by the host app when needed.
- **Harness maintenance burden**: linting, dependency analysis, API reports, package checks, and security workflows now provide stronger coverage, but they need intentional updates when package exports, CI support windows, or generated artifacts change.
- **Contract duplication**: SDK event definitions and collector validation/event handling are maintained separately, creating drift risk.

## 9) Coding-agent guidance

Before changing behavior:

1. Read package docs: `packages/heat-sdk/ARCHITECTURE.md` and `packages/heat-collector/ARCHITECTURE.md`.
2. Verify payload contract alignment across:
   - `packages/heat-sdk/src/index.ts`
   - `packages/heat-collector/src/validation.ts`
   - `packages/heat-collector/src/collector.ts`
3. For SDK lifecycle, privacy, or micro-frontend changes, inspect storage namespace, storage fallback, multi-batch flush/shutdown, and shared History API patching.
4. For DB-impacting changes, inspect:
   - `packages/heat-collector/src/schema.ts`
   - `packages/heat-collector/src/db.ts`
   - collector tests + mongodb tests.
5. Run minimum validation:
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
4. Should query APIs gain optional non-breaking authentication middleware for deployments that expose them outside trusted networks?
