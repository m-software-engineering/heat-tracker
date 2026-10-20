# @m-software-engineering/heat-sdk

## 0.3.0

### Minor Changes

- 93afe54: ## Breaking

  1. **Error `error` field: string → object.**
     Before: `{ "error": "invalid jwt", "code": "invalid_jwt", … }`. After: `{ "error": { "code": "HEAT_E_JWT_EXPIRED", "message": "The JWT has expired.", … }, … }`.
     What to do: replace `body.error` with `body.error.message`, and `body.code` with `body.error.code`.
  2. **Non-JSON or missing `Content-Type` on `POST /ingest` → 415.**
     Before: `Content-Type: text/plain` (or no header) returned 400 `invalid_payload`. After: 415 `HEAT_E_UNSUPPORTED_MEDIA_TYPE`.
     What to do: send `Content-Type: application/json` (the SDK already does).
  3. **Strict JWT `kid`.**
     Before: a token whose `kid` was not in the JWKS was checked against the first key. After: 401 `HEAT_E_JWKS_KEY_NOT_FOUND`.
     What to do: publish every signing key in the JWKS, or issue tokens with a `kid` that the JWKS lists.

  ## Other changes
  - Add opt-in `collector.notFoundHandler`, a JSON 404 (`HEAT_E_ROUTE_NOT_FOUND`). Mount it last (`app.use(collector.notFoundHandler)`); `collector.router` itself never answers unknown paths, so host routes registered after it keep working.
  - Add `@m-software-engineering/heat-errors`: one `HeatError` shape (`HEAT_E_*` code, message, cause, fix, docs, requestId, status, details) for the SDK, collector, CLI, and DB layer. See `docs/errors.md`.
  - When the JWKS cannot be downloaded, the collector returns 503 `HEAT_E_AUTH_JWKS_UNAVAILABLE` with `Retry-After: 30` (it used to return 401 `invalid_jwt`). The JWKS URL appears only in server logs.
  - Top-level `code`, `message`, `requestId`, and `details` are deprecated and will be removed in the next major version. Responses that still carry them send `Deprecation: true` and `Link: <…/docs/errors.md#migrating-from-legacy-fields>; rel="deprecation"`, and the collector logs one warning per process that names each replacement (`code -> error.code`, …).
  - JWT failures have specific codes. Query validation errors name the parameter, the received value, and the expected format in `details.fieldErrors`. Logs mask project keys and truncate IPs, and record code + cause, never stacks.
  - `heat-collector-migrate` reports failures as driver error class + code + host (never credentials) and adds the masked raw driver message only with `--verbose`.
  - SDK: `onError(err)` and `debug` (logs each code once per page load). `init()` names the missing config key(s) in `message`.

## 0.2.6

### Patch Changes

- Normalize invalid `batch.maxEvents` values to the default so auto-flush cannot get stuck on empty batches.
- Drain all queued batches during `flush()` and `shutdown()`, including queues larger than `maxEvents`.
- Isolate session and localStorage queue keys by project key and endpoint so multiple trackers can safely share a page.
- Update internal SDK payload version metadata to `0.2.6` to keep collector metadata aligned with the published package version.

## 0.2.5

### Patch Changes

- Capture click and move coordinates in page/document space (including scroll offsets) so heatmaps remain accurate after scrolling.
- Keep move/click coordinate semantics aligned with collector rendering updates for long-page and below-the-fold interactions.
- Update internal SDK payload version metadata to `0.2.5` to keep collector metadata aligned with the published package version.

## 0.2.4

### Patch Changes

- Fix localStorage queue persistence so successfully delivered events are removed from storage, preventing replay of already-sent batches after page reloads.
- Ensure persisted queue snapshots stay aligned with in-memory queue trimming when `maxQueueBytes` is enforced.
- Update internal SDK payload version metadata to `0.2.4` to keep collector metadata aligned with the published package version.

## 0.2.3

### Patch Changes

- Fix `shutdown()` to flush queued events before stopping, preventing event loss when applications close the tracker quickly.
- Restore patched `history.pushState` and `history.replaceState` methods during shutdown to avoid leaking SDK wrappers across tracker lifecycles.
- Update internal SDK payload version metadata to `0.2.3` so collector metadata remains aligned with the published package version.

## 0.2.2

### Patch Changes

- Fix published entrypoints for CommonJS and ESM consumers (`main`, `module`, and `exports`) so runtime imports resolve correctly from npm packages.
- Update internal SDK version metadata to `0.2.2` so collector payload metadata matches the published package version.

## 0.2.1

### Patch Changes

- Atualiza a documentação geral e dos pacotes, incluindo setup de integração com NestJS no collector.
  Também corrige a versão reportada internamente pelo SDK para ficar alinhada ao pacote publicado.

## 0.2.0

### Minor Changes

- Add package-level READMEs with usage snippets for common frameworks.
