---
"@m-software-engineering/heat-sdk": minor
"@m-software-engineering/heat-errors": minor
---

The reference dashboard now knows a framed page is really showing only from an SDK handshake (#59), because Chromium fires the iframe's `load` event for its own error page. `init()` posts `{ type: "heat-tracker:frame-hello", href: location.href }` to `window.parent` when the page is framed (before the DNT and sampling gates; it carries no tracking data). The dashboard accepts it only from the iframe's window and from the page's origin or an allowlisted one. Without a valid handshake within 8 s it shows `HEAT_E_FRAME_NO_RESPONSE` ("This page didn't respond. It may block framing or be offline.") with an "Open page in new tab" link, which covers X-Frame-Options, CSP and unreachable sites. A handshake from another host or path shows `HEAT_E_FRAME_REDIRECTED` and hides the heatmap. The dashboard sends `Content-Security-Policy: frame-src` restricted to `HEAT_DASHBOARD_SITE_ORIGINS`. `DASHBOARD_ERRORS` gains `HEAT_E_FRAME_NO_RESPONSE` and `HEAT_E_FRAME_REDIRECTED`; `docs/errors.md` includes them.
