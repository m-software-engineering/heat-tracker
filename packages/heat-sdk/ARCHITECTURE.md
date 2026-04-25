# heat-sdk Architecture (`packages/heat-sdk`)

## 1) Package purpose

`@m-software-engineering/heat-sdk` is a browser-only tracking SDK that captures interaction events, enriches them with session/device/page metadata, batches them, and sends ingestion payloads to heat-collector-compatible endpoints.

## 2) Public API surface

Entry point: `src/index.ts`.

Exports:
- `init(config: InitConfig): Tracker`
- Types: `InitConfig`, `Tracker`, `AnyEvent`

`Tracker` methods:
- `identify(userId, traits?)`
- `setAuthToken(jwt | null)`
- `track(name, props?)`
- `flush()`
- `shutdown()`

Primary consumers appear to be browser applications and framework integrations (React/Angular examples in README).

## 3) Internal architecture

Core structure in `src/index.ts`:
- **Config layer**: `DEFAULT_CONFIG` + `ensureConfig` for resolved defaults.
- **Event model**: discriminated event types (`click`, `move`, `scroll`, `pageview`, `custom`, `input`, `keyboard`).
- **Runtime engine**: `TrackerImpl` class managing lifecycle, listeners, queue, and transport.
- **Persistence**:
  - Session identity in `sessionStorage` or `localStorage` (configurable `session.persist`).
  - Queue persistence optional via `batch.storage = "localStorage"`.
- **Transport**:
  - `fetch` POST to endpoint with `x-project-key` and optional Bearer token.
  - Retry with exponential backoff + jitter on failure.

Boundaries:
- Browser globals required (`window`, DOM, history, storage, navigator).
- No direct dependency on collector package; integration is contract-over-HTTP.

## 4) Core traits and abstractions

TypeScript types act as the main abstraction set (no TS interfaces implemented by multiple classes besides API types):
- `InitConfig` / `ResolvedConfig`: extension and behavior-control contract.
- `Tracker`: stable consumer-facing runtime interface.
- Event payload unions (`AnyEvent` and concrete event types): internal + transport contract.

Operational helpers:
- `eventPagePoint`, `computeScrollDepth`, `elementSelector`, `classifyKey` encapsulate capture semantics.
- `createNoopTracker` provides compliant fallback for DNT/sampling bypass.

## 5) Error handling and validation model

- Hard validation at init:
  - Throws if missing `endpoint` or `projectKey`.
  - Throws if called outside browser.
- Soft-fail model for storage/serialization/listener edge cases:
  - Extensive `try/catch` around storage and JSON operations to avoid app breakage.
- Network failure handling:
  - Failed sends requeue events and schedule retries.
- Privacy gating:
  - DNT returns noop tracker.
  - Sensitive selectors/inputs are filtered before enqueue.

## 6) Testing strategy

Discovered tests: `src/index.test.ts` (Vitest + jsdom).

Covered behaviors include:
- click capture and flush transport
- scroll-offset coordinate correctness
- input masking
- DNT compliance
- shutdown flush and history restoration
- localStorage queue cleanup

Recommended commands:
- `pnpm -C packages/heat-sdk test`
- `pnpm -C packages/heat-sdk test:coverage`
- `pnpm -C packages/heat-sdk typecheck`
- `pnpm -C packages/heat-sdk build`

## 7) Extension points

Safe feature additions:
1. Add config flag under `InitConfig.capture` or `privacy`.
2. Implement dedicated handler in `TrackerImpl`.
3. Ensure emitted event payload aligns with collector validation schema.
4. Add tests in `src/index.test.ts` for capture + transport semantics.

When adding event types:
- Update `AnyEvent` union and enqueue logic.
- Coordinate collector updates (`validation.ts`, insert/query/heatmap behavior).
- Add backward-compatible behavior for existing consumers where possible.

## 8) Anti-patterns and risks

- **Single-file concentration**: almost all SDK logic is in `src/index.ts`, making targeted changes harder.
- **Literal SDK version constant** (`SDK_VERSION`) can drift from `package.json` if not kept in sync.
- **Global patching of History API** is correctly restored on shutdown, but fragile if app/framework patches history too.
- **Best-effort queue byte sizing** via `JSON.stringify(queue).length` may differ from actual transport/storage byte counts.

## 9) Coding-agent checklist

Before changes:
- Read `src/index.ts` end-to-end (config merge, listeners, transport, storage keys).
- Check collector contract expectations in:
  - `../heat-collector/src/validation.ts`
  - `../heat-collector/src/collector.ts`
- Identify whether change touches privacy-sensitive paths (`isSensitiveInput`, selectors, DNT).

After changes:
- Run `pnpm -C packages/heat-sdk test`.
- If event contract changed, run collector tests too.
- Verify no listener leaks (especially around `shutdown`).
- Verify docs/README if API surface changed.
