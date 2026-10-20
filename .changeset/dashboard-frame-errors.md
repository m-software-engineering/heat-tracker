---
"@m-software-engineering/heat-errors": minor
---

Add `DASHBOARD_ERRORS` for the reference dashboard: `HEAT_E_FRAME_BLOCKED` (the site forbids framing; the fix names the `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` header) `HEAT_E_FRAME_ORIGIN_NOT_ALLOWED` (the site origin is not in `HEAT_DASHBOARD_SITE_ORIGINS`; the fix names that variable) and `HEAT_E_DASHBOARD_FETCH` (the dashboard could not read heatmap data). `getCatalog()` and `docs/errors.md` include them. Also adds `HEAT_E_FRAME_ORIGIN_INVALID` (an allowlist entry is not an origin; wildcards are not supported) and `HEAT_E_FRAME_CHECK_UNVERIFIED` (no framing verdict, so the page is not loaded).
