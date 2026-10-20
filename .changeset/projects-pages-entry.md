---
"@m-software-engineering/heat-collector": minor
"@m-software-engineering/heat-sdk": minor
"@m-software-engineering/heat-errors": minor
---

Projects and popular pages, with titles, as the dashboard entry point (#25).

- Collector: `GET /api/projects` (every project with `projectKey`, `eventsLast24h`, `lastEventAt`, `receivingData`; no-event projects first, then most recent event) and `GET /api/projects/:projectId/pages?from&to&limit&cursor` (pages with a pageview in the window, default last 7 days, sorted by distinct pageview sessions, with clicks and the latest-seen title, falling back to the path). Cursor pagination: `limit` defaults to 50 and is clamped to 200 (`meta.limit` returns the applied value); at most 2 database queries per request. `autoMigrate` creates the `pages` table and the `events_project_type_ts_idx` / `events_project_ts_idx` indexes. p95 ≤ 200 ms with 10 k pages / 1 M events on Postgres (`bench:pages`).
- **Behavior change (collector):** stored paths never keep a query param whose name (decoded, NFKC, lowercased) has a token, split on `-`, `_` and camelCase, in `token`, `key`, `secret`, `password`, `passwd`, `auth`, `sig`, `signature`, `jwt`, `session`; or whose whole name without `-`/`_` is `apikey`, `accesstoken`, `authtoken`, `refreshtoken`, `idtoken`, `sessionid`, `sessiontoken`, `clientsecret`, `xamzsignature`, `code`, `otp`, `authcode` or `verificationcode` (so `keyboard`, `author`, `zipcode`, `country_code` stay); a name that cannot be decoded; or a value that looks like an email (alphabetic TLD of 2+ letters that is not a file extension, so `logo@2x.png` and `react@18.2.0` stay), and `;matrix` path params are dropped (`/p;jsessionid=x` → `/p`) and email-looking path segments become `[email]` (path decoding: `+` stays `+`), on every ingest.
- **Behavior change (SDK):** event paths are `location.pathname` only by default; the query string and hash are dropped. Keep specific params with `privacy.keepQueryParams` (sensitive params are never kept; email-looking path segments become `[email]`). Pageviews send `title` (`document.title`, masked with `maskTextSelectors`, ≤ 200 characters); disable with `capture.pageTitle: false`.
- New error codes: `HEAT_E_PROJECT_NOT_FOUND`, `HEAT_E_QUERY_CURSOR`, `HEAT_E_PROJECTS_QUERY_FAILED`, `HEAT_E_PAGES_QUERY_FAILED`.
- **Behavior change (collector):** `/ingest` answers `HEAT_E_PROJECT_KEY_INVALID` (400) for an `x-project-key` outside `[A-Za-z0-9_-]{1,128}`.
- Dashboard: the install snippet writes the endpoint and projectKey as escaped JS strings (`JSON.stringify`, `<` as `\u003c`).
