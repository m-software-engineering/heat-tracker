---
"@m-software-engineering/heat-collector": minor
"@m-software-engineering/heat-sdk": minor
"@m-software-engineering/heat-errors": minor
---

Projects and popular pages, with titles, as the dashboard entry point (#25).

- Collector: `GET /api/projects` (every project with `eventsLast24h`, `lastEventAt`, `receivingData`) and `GET /api/projects/:projectId/pages?from&to&limit&cursor` (pages with a pageview in the window, default last 7 days, sorted by distinct pageview sessions, with clicks and the latest-seen title, falling back to the path). Cursor pagination: `limit` defaults to 50 and is clamped to 200 (`meta.limit` returns the applied value); at most 2 database queries per request. `autoMigrate` creates the `pages` table and the `events_project_type_ts_idx` / `events_project_ts_idx` indexes. p95 ≤ 200 ms with 10 k pages / 1 M events on Postgres (`bench:pages`).
- **Behavior change (collector):** stored paths never keep the query params `token`, `email`, `code`, `password`, `secret`, `key`, `auth`, `session*` or any email-looking value, on every ingest.
- **Behavior change (SDK):** event paths are `location.pathname` only by default; the query string and hash are dropped. Keep specific params with `privacy.keepQueryParams` (sensitive params are never kept). Pageviews send `title` (`document.title`, masked with `maskTextSelectors`, ≤ 200 characters); disable with `capture.pageTitle: false`.
- New error codes: `HEAT_E_PROJECT_NOT_FOUND`, `HEAT_E_QUERY_CURSOR`, `HEAT_E_PROJECTS_QUERY_FAILED`, `HEAT_E_PAGES_QUERY_FAILED`.
