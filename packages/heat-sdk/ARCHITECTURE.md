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

Core runtime in `src/index.ts`; event/config types, resolved defaults, and browser helpers live in `src/runtime.ts`:

- **Config layer**: `DEFAULT_CONFIG` + `ensureConfig` for resolved defaults and guardrails such as finite positive `batch.maxEvents`.
- **Event model**: discriminated event types (`click`, `move`, `scroll`, `pageview`, `custom`, `input`, `keyboard`).
- **Runtime engine**: `TrackerImpl` class managing lifecycle, listeners, queue, and transport.
- **Persistence**:
  - Session identity in `sessionStorage` or `localStorage` (configurable `session.persist`).
  - Session and queue keys are namespaced by a stable hash of `projectKey|endpoint`, which prevents same-page trackers from replaying one project's data through another.
  - Queue persistence always uses `sessionStorage`, with no configuration option; it survives reload in the same tab and is cleared when the tab closes.
  - Each event gets a stable `eventId` at creation; the sessionStorage queue persists it so exit resends and next-page replay reuse the same id (collector dedupes on it).
  - Queued and in-flight events remain persisted until acknowledgement; init immediately flushes restored queues. Delivery is at-least-once, so reload can replay a delivered but unacknowledged event.
  - Session identity falls back to memory when storage is blocked. Queue storage failures keep events in memory until an exit cannot deliver/persist them; actual drops report `HEAT_E_EVENTS_DROPPED` with `details.dropped`.
- **Transport**:
  - `fetch` POST to endpoint with `x-project-key` and optional Bearer token.
  - Retry with exponential backoff + jitter on failure.
  - `src/page-exit.ts` attaches pagehide/hidden listeners and owns one 60,000-byte lifetime budget shared across trackers and all keepalive bodies. Ordinary sends use non-keepalive fetch once it is exhausted. Exit handlers never retry the same event twice, including synchronous transport failures; oversized/over-budget events are persisted for reload, or dropped with a count when persistence fails.
- **Page identity** (`src/page-info.ts`, #25): every event's `path` is `location.pathname` only; query params listed in `privacy.keepQueryParams` are kept unless sensitive (token rule shared with the collector: `src/privacy-rules.ts` is byte-identical to the collector's and both run `fixtures/privacy-cases.json`); `;matrix` params are dropped and email-looking path segments become `[email]`; the raw pairs are kept (no form decoding, so `+` stays `+`); the hash is dropped. Pageviews carry `title` (`document.title` with `maskTextSelectors` text replaced by •••, whitespace collapsed, ≤ 200 characters; omitted when empty, fully masked, `capture.pageTitle: false`, or unchanged across an SPA navigation, since routers often set the new title after `pushState`).
- **Navigation capture**:
  - A shared History API patch manager fans out navigation notifications to all active pageview trackers and restores methods when the last tracker shuts down.

- **Frame handshake** (`src/frame-handshake.ts`): with `dashboardOrigins` set and the page framed, `init` posts `{ type: "heat-tracker:frame-hello", href: origin + pathname }` (no query or hash) to `window.parent` once per listed origin, with that origin as `targetOrigin` (never `*`), with the pathname through `sanitizePathname` (`src/privacy-rules.ts`), never with Do Not Track on, before the sampling gate, and never throws. Without the option nothing is sent. The reference dashboard uses it to tell a real page from a blocked or error frame (#59).

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
- `getBrowserStorage`, `stableHash`, `storageKey`, and `writeStorage` helpers encapsulate storage fallback and per-project/per-endpoint namespacing.
- Input focus, blur, and change listeners share one handler, using the DOM event type as the captured action.
- `createNoopTracker` reuses synchronous and async no-op functions for DNT/sampling bypass. Listener setup calls the shared History API manager directly, without per-tracker forwarding methods; internal state names stay short to reduce the browser bundle.

## 5) Error handling and validation model

- Hard validation at init (throws `HeatTrackerError`):
  - `HEAT_E_CONFIG_MISSING` naming the missing `endpoint`/`projectKey`.
  - `HEAT_E_NOT_BROWSER` if called outside browser.
- After init the SDK never throws into the host page. `src/errors.ts` reports ingest failures to `onError(err: HeatError)` (the collector's own `error` when present, else `HEAT_E_INGEST_HTTP`/`HEAT_E_INGEST_NETWORK`) and, with `debug: true`, logs each code once per page load. Silent otherwise.
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
- identified-user and bearer-auth payloads, click/pointer coordinates, History API navigation capture, and failed-batch retry
- sessionStorage queue cleanup, reload replay, throwing storage, and shared exit budgets
- `e2e/sdk.e2e.spec.ts` covers click then actual tab close (fetch keepalive preserves required auth headers), shared pagehide/hidden budgeting, and actual reload recovery against the collector

Recommended commands:

- `pnpm -C packages/heat-sdk test`
- `pnpm -C packages/heat-sdk test:coverage`
- `pnpm -C packages/heat-sdk typecheck`
- `pnpm -C packages/heat-sdk build`
- `pnpm -C packages/heat-sdk lint`
- `pnpm -C packages/heat-sdk pack:check`

Harness notes:

- Coverage thresholds are enforced in `vitest.config.ts` for SDK source files, and Vitest emits `json-summary` coverage for GitHub Actions quality summaries.
- The test harness uses the patched Vitest 4.1 line with its matching V8 coverage provider; the root workspace constrains Vitest's compatible Vite dependency to the patched 6.4 line.
- Package validation uses `publint`, `attw --pack`, and API Extractor against the built `dist` output.
- The package export map splits ESM and CommonJS type resolution to keep browser consumers and package checkers aligned.

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
- `SDK_VERSION` is injected at build time from `package.json` (`tsup.config.ts`, `vitest.config.ts`).
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
