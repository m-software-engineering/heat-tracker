---
"@m-software-engineering/heat-errors": minor
---

Add `DASHBOARD_ERRORS.HEAT_E_FRAME_CHECK_INCONCLUSIVE` for the reference dashboard: when the server-side frame check times out or cannot reach the site, the dashboard now fails open, loads the page and shows "We couldn't check whether this site allows framing. If the page stays blank, the site likely blocks it." If the page has not loaded within 8 s it shows `HEAT_E_FRAME_BLOCKED`. `HEAT_E_FRAME_CHECK_UNVERIFIED` (fail closed) still applies to invalid redirect chains and a failed frame-check route. `docs/errors.md` includes the new code.
