---
"@m-software-engineering/heat-errors": minor
---

Add `DASHBOARD_ERRORS` for the reference dashboard: `HEAT_E_FRAME_BLOCKED` (the site forbids framing; the fix names the `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` header) and `HEAT_E_DASHBOARD_FETCH` (the dashboard could not read heatmap data). `getCatalog()` and `docs/errors.md` include them.
