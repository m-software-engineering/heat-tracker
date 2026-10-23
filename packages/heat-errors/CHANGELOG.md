# @m-software-engineering/heat-errors

## 0.2.0

### Minor Changes

- 08a7a8b: Self-hosting groundwork (#24).

  - New `heat-collector` binary: `heat-collector` (or `serve`) starts the collector on port 4000 from environment variables, fails fast with `HEAT_E_DB_CONFIG` (no `DATABASE_URL`) or `HEAT_E_DB_UNREACHABLE` (cause names host:port, never the password), generates an admin token once and keeps it in `HEAT_DATA_DIR/admin-token`, and prints a startup block with the dashboard URL, the token and `docker compose exec collector heat-collector token`. `heat-collector token` prints the token again.
  - New opt-in `admin: { token }` collector option: `/api/*` then requires `Authorization: Bearer <token>` and answers 401 `HEAT_E_ADMIN_TOKEN_MISSING` / `HEAT_E_ADMIN_TOKEN_INVALID`. Without it the read API is unchanged.
  - The server survives a dropped idle Postgres connection (logged as `HEAT_E_DB_CONNECTION_LOST`, the pool reconnects), names `ENOTFOUND` when the database host does not resolve, requires `HEAT_ADMIN_TOKEN` to be at least 32 characters, refuses an empty token file instead of crash-looping, and accepts `HEAT_TRUST_PROXY=true|false|<hops>|<addresses>`.
  - New `GET /healthz` liveness route and `GET /api/projects/by-key/:projectKey`.
  - Projects created by their first ingest are now named after the request `Origin` instead of `Default` (requests without an `Origin` still get `Default`).
  - New error codes: `HEAT_E_ADMIN_TOKEN_MISSING`, `HEAT_E_ADMIN_TOKEN_INVALID`, `HEAT_E_PROJECT_QUERY_FAILED`, `HEAT_E_DB_UNREACHABLE`, `HEAT_E_ADMIN_TOKEN_STORE`, `HEAT_E_SERVER_LISTEN`, `HEAT_E_SERVER_COMMAND`, `HEAT_E_SERVER_CONFIG`, `HEAT_E_DB_CONNECTION_LOST`, `HEAT_E_ADMIN_TOKEN_FILE_INVALID`, `HEAT_E_ADMIN_TOKEN_WEAK`. `HEAT_E_DB_CONFIG`'s fix now mentions `DATABASE_URL`.

- a3b6156: Add `DASHBOARD_ERRORS` for the reference dashboard: `HEAT_E_FRAME_BLOCKED` (the site forbids framing; the fix names the `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` header) `HEAT_E_FRAME_ORIGIN_NOT_ALLOWED` (the site origin is not in `HEAT_DASHBOARD_SITE_ORIGINS`; the fix names that variable) and `HEAT_E_DASHBOARD_FETCH` (the dashboard could not read heatmap data). `getCatalog()` and `docs/errors.md` include them. Also adds `HEAT_E_FRAME_ORIGIN_INVALID` (an allowlist entry is not an origin; wildcards are not supported) and `HEAT_E_FRAME_CHECK_UNVERIFIED` (no framing verdict, so the page is not loaded).
- c52b664: New SDK option `dashboardOrigins: string[]` (#59). When the page is framed, `init()` posts `{ type: "heat-tracker:frame-hello", href: origin + pathname }` (no query or hash) to each listed origin, with that origin as the exact `targetOrigin`, never `*`. The pathname goes through the shared privacy rules (`;matrix` params dropped, emails become `[email]`). Nothing is sent without the option or when Do Not Track is on. The reference dashboard uses this handshake instead of the iframe's `load` event, which Chromium fires for its own error page: its onboarding snippet fills in `dashboardOrigins` with the dashboard's origin. The dashboard accepts a hello only from the iframe's window and from the page's origin or an allowlisted one. Framing blocked by `X-Frame-Options` or CSP, as detected by the server check, shows `HEAT_E_FRAME_BLOCKED` at once. An inconclusive check without a valid hello within 8 s shows `HEAT_E_FRAME_NO_RESPONSE` ("This page didn't respond. Check that the heat-tracker snippet is installed with this dashboard in dashboardOrigins, that the site allows framing, and that Do Not Track is off in this browser.") with an "Open page in new tab" link. A hello from another host or path shows `HEAT_E_FRAME_REDIRECTED` and hides the heatmap. The dashboard sends `Content-Security-Policy: frame-src` restricted to `HEAT_DASHBOARD_SITE_ORIGINS`. `DASHBOARD_ERRORS` gains `HEAT_E_FRAME_NO_RESPONSE` and `HEAT_E_FRAME_REDIRECTED`; `docs/errors.md` includes them.
- 0307fa2: Projects and popular pages, with titles, as the dashboard entry point (#25).

  - Collector: `GET /api/projects` (every project with `projectKey`, `eventsLast24h`, `lastEventAt`, `receivingData`; no-event projects first, then most recent event) and `GET /api/projects/:projectId/pages?from&to&limit&cursor` (pages with a pageview in the window, default last 7 days, sorted by distinct pageview sessions, with clicks and the latest-seen title, falling back to the path). Cursor pagination: `limit` defaults to 50 and is clamped to 200 (`meta.limit` returns the applied value); at most 2 database queries per request. `autoMigrate` creates the `pages` table and the `events_project_type_ts_idx` / `events_project_ts_idx` indexes. p95 ≤ 200 ms with 10 k pages / 1 M events on Postgres (`bench:pages`).
  - **Behavior change (collector):** stored paths never keep a query param whose name (decoded, NFKC, lowercased; split on `-` `_` `[` `]` `.` `+`, space, camelCase and digit/letter boundaries) has a token in `token`, `key`, `secret`, `password`, `passwd`, `auth`, `authorization`, `sig`, `signature`, `jwt`, `session`, `bearer`, `cookie`, `credential(s)`, `csrf`, `xsrf`, `nonce`, `hmac`, `pwd`, `pass`, `passcode`, `otp`, `ssn`, `ticket`, `assertion`, `samlresponse`; or a token ending in `token`, `secret` or `sessid`, or `secret`/`private`/`access`/`api`/`my`/`client`/`session` + `key`; or whose whole name is `apikey`, `accesstoken`, `authtoken`, `refreshtoken`, `idtoken`, `sessionid`, `sessiontoken`, `clientsecret`, `xamzsignature`, `sid`, `pin`, `jsessionid`, `phpsessid`, `oauthverifier`, `policy`, `oobcode`, `otpcode`, `code`, `authcode` or `verificationcode` (so `promo-code`, `postcode`, `keyword`, `turkey`, `author`, `passport` stay; the lists are frozen, a new case needs a fixture in `fixtures/privacy-cases.json` and its own issue); a name that cannot be decoded; or a value that looks like an email (alphabetic TLD of 2+ letters that is not a file extension such as png, heic, tiff, mov, csv, zip, pdf; so `logo@2x.png` and `react@18.2.0` stay), and `;matrix` path params are dropped (`/p;jsessionid=x` → `/p`) and email-looking path segments become `[email]` (path decoding: `+` stays `+`), on every ingest.
  - **Behavior change (SDK):** event paths are `location.pathname` only by default; the query string and hash are dropped. Keep specific params with `privacy.keepQueryParams` (sensitive params are never kept; email-looking path segments become `[email]`). Pageviews send `title` (`document.title`, masked with `maskTextSelectors`, ≤ 200 characters); disable with `capture.pageTitle: false`.
  - New error codes: `HEAT_E_PROJECT_NOT_FOUND`, `HEAT_E_QUERY_CURSOR`, `HEAT_E_PROJECTS_QUERY_FAILED`, `HEAT_E_PAGES_QUERY_FAILED`.
  - **Behavior change (collector):** `/ingest` answers `HEAT_E_PROJECT_KEY_INVALID` (400) for an `x-project-key` outside `[A-Za-z0-9_-]{1,128}`.
  - Dashboard: the install snippet writes the endpoint and projectKey as escaped JS strings (`JSON.stringify`, `<` as `\u003c`).

- 5a1481a: Adds `HEAT_E_COLLECTOR_UNREACHABLE`, `HEAT_E_DASHBOARD_CONTENT_TYPE` and `HEAT_E_DASHBOARD_ORIGIN` (the dashboard's token endpoint accepts only same-origin JSON). `HEAT_E_COLLECTOR_UNREACHABLE` is shown by the reference dashboard as "Can't reach the collector at {url}." with a Retry button. The repository now ships a self-hosted stack (#24): root `docker-compose.yml` (Postgres + collector on 4000 + dashboard on 3000, pinned GHCR images, hardened), `compose.dev.yml` for local builds, Dockerfiles for the collector and dashboard, and dashboard onboarding (admin token in an HttpOnly cookie, snippet with copy button, live first-event state). Until GHCR images are published, the quick start builds them with `docker compose -f docker-compose.yml -f compose.dev.yml up`.

## 0.1.0

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
