# @m-software-engineering/heat-collector

## 0.5.0

### Minor Changes

- 08a7a8b: Self-hosting groundwork (#24).

  - New `heat-collector` binary: `heat-collector` (or `serve`) starts the collector on port 4000 from environment variables, fails fast with `HEAT_E_DB_CONFIG` (no `DATABASE_URL`) or `HEAT_E_DB_UNREACHABLE` (cause names host:port, never the password), generates an admin token once and keeps it in `HEAT_DATA_DIR/admin-token`, and prints a startup block with the dashboard URL, the token and `docker compose exec collector heat-collector token`. `heat-collector token` prints the token again.
  - New opt-in `admin: { token }` collector option: `/api/*` then requires `Authorization: Bearer <token>` and answers 401 `HEAT_E_ADMIN_TOKEN_MISSING` / `HEAT_E_ADMIN_TOKEN_INVALID`. Without it the read API is unchanged.
  - The server survives a dropped idle Postgres connection (logged as `HEAT_E_DB_CONNECTION_LOST`, the pool reconnects), names `ENOTFOUND` when the database host does not resolve, requires `HEAT_ADMIN_TOKEN` to be at least 32 characters, refuses an empty token file instead of crash-looping, and accepts `HEAT_TRUST_PROXY=true|false|<hops>|<addresses>`.
  - New `GET /healthz` liveness route and `GET /api/projects/by-key/:projectKey`.
  - Projects created by their first ingest are now named after the request `Origin` instead of `Default` (requests without an `Origin` still get `Default`).
  - New error codes: `HEAT_E_ADMIN_TOKEN_MISSING`, `HEAT_E_ADMIN_TOKEN_INVALID`, `HEAT_E_PROJECT_QUERY_FAILED`, `HEAT_E_DB_UNREACHABLE`, `HEAT_E_ADMIN_TOKEN_STORE`, `HEAT_E_SERVER_LISTEN`, `HEAT_E_SERVER_COMMAND`, `HEAT_E_SERVER_CONFIG`, `HEAT_E_DB_CONNECTION_LOST`, `HEAT_E_ADMIN_TOKEN_FILE_INVALID`, `HEAT_E_ADMIN_TOKEN_WEAK`. `HEAT_E_DB_CONFIG`'s fix now mentions `DATABASE_URL`.

- b33f7b8: Heatmaps are aggregated in the database. `GET /api/projects/:projectId/heatmap` now runs grouped queries (`GROUP BY` on bucketed coordinates for Postgres, MySQL and SQLite; aggregation pipelines for MongoDB) instead of loading every matched event into Node, so collector memory no longer grows with traffic. Whole hours are served from a `heatmap_rollup` table that ingest keeps up to date, so 1 M events stay within p95 ≤ 500 ms. Output is golden-tested on every database, plus `meta.totalEvents`, `meta.sampled` (`false`), `meta.range`, `meta.excluded` and `meta.viewportBuckets`.

  - `autoMigrate` creates the `events_project_path_type_ts_idx` index on (project, path, type, ts), adds `events.viewport_bucket` (filled for existing rows) `events.rollup_state`, and creates and backfills `heatmap_rollup` in locked batches (safe under concurrent ingest; never double-counts). Ingest writes events and rollup in one transaction. The first start after upgrading reads every stored event once (about 75 s per 1M events on Postgres).
  - **Behavior change:** without `from` and `to` a heatmap covers the last 7 days (ending with the current hour) instead of all time; `meta.range` returns the applied range.
  - **Behavior change (SQL):** `click`/`move` events without coordinates are no longer plotted at 0,0; they are skipped (as MongoDB already did) and counted in `meta.excluded.noCoordinates`.
  - New `viewport=<w>x<h>` query param filters events by stored viewport bucket.
  - Without `viewportBucket`, the default viewport is the most common bucket among the 10,000 most recent matching events (identical to before when fewer events match).
  - `viewportBucket` must be `<width>x<height>` (e.g. `1440x900`); other values now return 400 `HEAT_E_QUERY_INVALID` naming the param instead of silently using 1280x720.

  During a rolling upgrade, events written by older collectors are counted before heatmap reads and by a periodic background catch-up (`heatmap.rollupCatchUpIntervalMs`), so whole-hour heatmaps no longer miss them. Adds `Collector.close()` and the `HEAT_E_ROLLUP_CATCH_UP` error code.

- a3b6156: The heatmap `viewport` filter accepts several buckets (`viewport=400x800,400x900`), so a dashboard can filter a whole viewport class. The first bucket sets the grid.
- 0307fa2: Projects and popular pages, with titles, as the dashboard entry point (#25).

  - Collector: `GET /api/projects` (every project with `projectKey`, `eventsLast24h`, `lastEventAt`, `receivingData`; no-event projects first, then most recent event) and `GET /api/projects/:projectId/pages?from&to&limit&cursor` (pages with a pageview in the window, default last 7 days, sorted by distinct pageview sessions, with clicks and the latest-seen title, falling back to the path). Cursor pagination: `limit` defaults to 50 and is clamped to 200 (`meta.limit` returns the applied value); at most 2 database queries per request. `autoMigrate` creates the `pages` table and the `events_project_type_ts_idx` / `events_project_ts_idx` indexes. p95 ≤ 200 ms with 10 k pages / 1 M events on Postgres (`bench:pages`).
  - **Behavior change (collector):** stored paths never keep a query param whose name (decoded, NFKC, lowercased; split on `-` `_` `[` `]` `.` `+`, space, camelCase and digit/letter boundaries) has a token in `token`, `key`, `secret`, `password`, `passwd`, `auth`, `authorization`, `sig`, `signature`, `jwt`, `session`, `bearer`, `cookie`, `credential(s)`, `csrf`, `xsrf`, `nonce`, `hmac`, `pwd`, `pass`, `passcode`, `otp`, `ssn`, `ticket`, `assertion`, `samlresponse`; or a token ending in `token`, `secret` or `sessid`, or `secret`/`private`/`access`/`api`/`my`/`client`/`session` + `key`; or whose whole name is `apikey`, `accesstoken`, `authtoken`, `refreshtoken`, `idtoken`, `sessionid`, `sessiontoken`, `clientsecret`, `xamzsignature`, `sid`, `pin`, `jsessionid`, `phpsessid`, `oauthverifier`, `policy`, `oobcode`, `otpcode`, `code`, `authcode` or `verificationcode` (so `promo-code`, `postcode`, `keyword`, `turkey`, `author`, `passport` stay; the lists are frozen, a new case needs a fixture in `fixtures/privacy-cases.json` and its own issue); a name that cannot be decoded; or a value that looks like an email (alphabetic TLD of 2+ letters that is not a file extension such as png, heic, tiff, mov, csv, zip, pdf; so `logo@2x.png` and `react@18.2.0` stay), and `;matrix` path params are dropped (`/p;jsessionid=x` → `/p`) and email-looking path segments become `[email]` (path decoding: `+` stays `+`), on every ingest.
  - **Behavior change (SDK):** event paths are `location.pathname` only by default; the query string and hash are dropped. Keep specific params with `privacy.keepQueryParams` (sensitive params are never kept; email-looking path segments become `[email]`). Pageviews send `title` (`document.title`, masked with `maskTextSelectors`, ≤ 200 characters); disable with `capture.pageTitle: false`.
  - New error codes: `HEAT_E_PROJECT_NOT_FOUND`, `HEAT_E_QUERY_CURSOR`, `HEAT_E_PROJECTS_QUERY_FAILED`, `HEAT_E_PAGES_QUERY_FAILED`.
  - **Behavior change (collector):** `/ingest` answers `HEAT_E_PROJECT_KEY_INVALID` (400) for an `x-project-key` outside `[A-Za-z0-9_-]{1,128}`.
  - Dashboard: the install snippet writes the endpoint and projectKey as escaped JS strings (`JSON.stringify`, `<` as `\u003c`).

### Patch Changes

- f6893db: The `better-sqlite3` peer range now accepts 12.x and 13.x as well as 11.x. Version 13 fixes the Node 24 worker crash (`Assertion failed: (env) != nullptr`). It needs Node 22 or later.
- bb1838e: Privacy rules: stop dropping a few known non-sensitive names (`primary_key`, `sort_key`, `cache-key`, `publishable_key`, `key_id`, `ticket_id`, `session_count`, `boarding_pass`, `pass_type`). Every other name dropped before still drops, and `signing`/`encryption`/`master`/`shared`/`app`/`consumer` join the `<prefix>key` list.
- Updated dependencies [08a7a8b]
- Updated dependencies [a3b6156]
- Updated dependencies [c52b664]
- Updated dependencies [0307fa2]
- Updated dependencies [5a1481a]
  - @m-software-engineering/heat-errors@0.2.0

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
