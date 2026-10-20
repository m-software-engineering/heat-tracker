# @m-software-engineering/heat-collector

## 0.4.0

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

### Patch Changes

- Updated dependencies [93afe54]
  - @m-software-engineering/heat-errors@0.1.0

## 0.3.8

### Patch Changes

- 5db6a9a: Raise the collector's production dependency security floors, including requiring `mysql2` 3.23.1 or newer so MySQL consumers do not pair the adapter with vulnerable older 3.x releases.

## 0.3.7

### Patch Changes

- Fix SQLite collector startup from the ESM package entrypoint by using ESM-compatible Drizzle schema imports.

## 0.3.6

### Patch Changes

- Assign request IDs before JSON parsing and return structured `invalid_json` / `payload_too_large` responses for parser errors.
- Scope rate-limit buckets to each collector instance and prune expired buckets to avoid cross-instance leakage in embedded hosts.
- Revalidate `hooks.onBeforeInsert` output before persistence so invalid hook transforms return structured client errors.
- Apply session `path` filtering before pagination in both SQL and MongoDB session queries.

## 0.3.5

### Patch Changes

- Improve heatmap Y-axis projection by scaling render height with observed interaction depth, reducing below-the-fold compression.
- Project scroll heatmap points using normalized scroll depth over the active render height for more consistent long-page hotspots.
- Document and align heatmap diagnostics with the latest SDK coordinate capture behavior.

## 0.3.4

### Patch Changes

- Fix MongoDB heatmap empty-response troubleshooting by keeping backward-compatible default `type=click` and automatically falling back to `type=all` when no type is provided and click returns zero rows.
- Add richer heatmap diagnostics (`requestedType`, `resolvedType`, `plotted`, `ignored`, `typeBreakdown`) and a new raw events troubleshooting endpoint: `GET /api/projects/:projectId/events`.
- Improve REST API reliability with structured error payloads, consistent request correlation headers (`X-Request-Id`), rate-limit context headers, and request lifecycle logging.
- Make SQL session listing compatible with stricter SQL modes by removing non-portable grouped projections and computing `eventCount` safely per returned session.

## 0.3.3

### Patch Changes

- Publish a patch version bump to align release metadata with the latest monorepo bugfix deployment.

## 0.3.2

### Patch Changes

- Publish a maintenance release aligned with monorepo consistency updates and workspace type-check improvements.

## 0.3.1

### Patch Changes

- Atualiza a documentação geral e dos pacotes, incluindo setup de integração com NestJS no collector.
  Também corrige a versão reportada internamente pelo SDK para ficar alinhada ao pacote publicado.

## 0.3.0

### Minor Changes

- Fix package module type so tsup emits `dist/index.cjs` for CommonJS consumers (including NestJS `require` resolution).

## 0.2.0

### Minor Changes

- Add package-level READMEs with usage snippets for common frameworks.
