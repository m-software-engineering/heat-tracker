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
- **Config layer**: `DEFAULT_CONFIG` + `ensureConfig` for resolved defaults and guardrails such as finite positive `batch.maxEvents`.
- **Event model**: discriminated event types (`click`, `move`, `scroll`, `pageview`, `custom`, `input`, `keyboard`).
- **Runtime engine**: `TrackerImpl` class managing lifecycle, listeners, queue, and transport.
- **Persistence**:
  - Session identity in `sessionStorage` or `localStorage` (configurable `session.persist`).
  - Session and queue keys are namespaced by a stable hash of `projectKey|endpoint`, which prevents same-page trackers from replaying one project's data through another.
  - Queue persistence is optional via `batch.storage = "localStorage"`.
  - Storage access falls back to in-memory storage when browser storage is unavailable or blocked.
- **Transport**:
  - `fetch` POST to endpoint with `x-project-key` and optional Bearer token.
  - Retry with exponential backoff + jitter on failure.
- **Navigation capture**:
  - A shared History API patch manager fans out navigation notifications to all active pageview trackers and restores methods when the last tracker shuts down.

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
- `getBrowserStorage`, `stableHash`, and the storage key helpers encapsulate storage fallback and per-project/per-endpoint namespacing.
- `createNoopTracker` provides compliant fallback for DNT/sampling bypass.

## 5) Error handling and validation model

- Hard validation at init:
  - Throws if missing `endpoint` or `projectKey`.
  - Throws if called outside browser.
- Soft-fail model for storage/serialization/listener edge cases:
  - Extensive `try/catch` around storage and JSON operations to avoid app breakage.
- Network failure handling:
  - Failed sends requeue events and schedule retries.
  - `flush()` and `shutdown()` drain queued events across multiple `maxEvents` batches until the queue is empty or a send fails.
- Privacy gating:
  - DNT returns noop tracker.
  - Sensitive selectors/inputs are filtered before enqueue.
  - Input and keyboard `allowlist` modes capture nothing when no allow selectors are configured.
  - Move capture applies the same blocked/private selector checks as click capture.

## 6) Testing strategy

Discovered tests: `src/index.test.ts` (Vitest + jsdom).

Covered behaviors include:
- click capture and flush transport
- scroll-offset coordinate correctness
- input masking
- DNT compliance
- storage namespacing across same-page trackers
- allowlist privacy behavior and blocked private move targets
- storage fallback when `sessionStorage` is unavailable
- multi-batch flush/shutdown behavior, including invalid `maxEvents` normalization
- shutdown flush and shared history restoration
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
- **Global patching of History API** is reference-counted across SDK instances and restored on shutdown, but remains fragile if an app/framework replaces history methods after the SDK patches them.
- **Best-effort queue byte sizing** via `JSON.stringify(queue).length` may differ from actual transport/storage byte counts.
- **In-memory storage fallback** keeps init non-crashing when storage is blocked, but cannot persist across reloads.

## 9) Coding-agent checklist

Before changes:
- Read `src/index.ts` end-to-end (config merge, listeners, transport, storage keys).
- Check collector contract expectations in:
  - `../heat-collector/src/validation.ts`
  - `../heat-collector/src/collector.ts`
- Identify whether change touches privacy-sensitive paths (`isSensitiveInput`, selectors, allowlist modes, move capture, DNT).
- For queue/session work, preserve project+endpoint namespacing and browser-storage fallback behavior.
- For navigation work, preserve multi-instance History API patch/restore semantics.

After changes:
- Run `pnpm -C packages/heat-sdk test`.
- If event contract changed, run collector tests too.
- Verify no listener leaks (especially around `shutdown`).
- Verify docs/README if API surface changed.
