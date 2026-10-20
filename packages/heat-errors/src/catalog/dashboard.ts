import type { LocalErrorDefinition } from "../types";

/** Errors shown by the reference dashboard (examples/nextjs-dashboard). */
export const DASHBOARD_ERRORS = {
  HEAT_E_FRAME_BLOCKED: {
    code: "HEAT_E_FRAME_BLOCKED",
    message: "Your site does not allow the dashboard to show it in a frame, so the heatmap is drawn on a blank page.",
    fix: "Add `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` on your site, then reload this page."
  },
  HEAT_E_FRAME_ORIGIN_NOT_ALLOWED: {
    code: "HEAT_E_FRAME_ORIGIN_NOT_ALLOWED",
    message: "This site isn't allowed yet.",
    fix: "Add its origin to HEAT_DASHBOARD_SITE_ORIGINS and restart the dashboard."
  },
  HEAT_E_FRAME_CHECK_UNVERIFIED: {
    code: "HEAT_E_FRAME_CHECK_UNVERIFIED",
    message: "The dashboard could not verify that this site may be shown in a frame, so the page is not loaded.",
    fix: "Check that the dashboard server can reach the site and that the site responds within 3 seconds, then reload this page."
  },
  HEAT_E_FRAME_ORIGIN_INVALID: {
    code: "HEAT_E_FRAME_ORIGIN_INVALID",
    message: "An entry in HEAT_DASHBOARD_SITE_ORIGINS is not an origin, so it is ignored.",
    fix: "List full origins such as https://shop.example.com, separated by commas. Wildcards like `*` or `*.example.com` are not supported; list each origin."
  },
  HEAT_E_COLLECTOR_UNREACHABLE: {
    code: "HEAT_E_COLLECTOR_UNREACHABLE",
    message: "The dashboard can't reach the collector.",
    fix: "Check that the collector container is running: `docker compose ps`."
  },
  HEAT_E_DASHBOARD_CONTENT_TYPE: {
    code: "HEAT_E_DASHBOARD_CONTENT_TYPE",
    message: "The dashboard session request is not JSON.",
    fix: 'Send the token as JSON with `Content-Type: application/json`, for example `{"token":"…"}`.'
  },
  HEAT_E_DASHBOARD_ORIGIN: {
    code: "HEAT_E_DASHBOARD_ORIGIN",
    message: "The dashboard session request came from another site.",
    fix: "Paste the token on the dashboard page itself. Behind a reverse proxy, forward the Host (or X-Forwarded-Host) and X-Forwarded-Proto headers unchanged."
  },
  HEAT_E_DASHBOARD_FETCH: {
    code: "HEAT_E_DASHBOARD_FETCH",
    message: "The dashboard could not read heatmap data from the collector.",
    fix: "Check the Collector Base URL, that the collector is running, and that it allows CORS from the dashboard origin."
  }
} as const satisfies Record<string, LocalErrorDefinition>;
