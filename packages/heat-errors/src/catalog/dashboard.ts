import type { LocalErrorDefinition } from "../types";

/** Errors shown by the reference dashboard (examples/nextjs-dashboard). */
export const DASHBOARD_ERRORS = {
  HEAT_E_FRAME_BLOCKED: {
    code: "HEAT_E_FRAME_BLOCKED",
    message: "Your site does not allow the dashboard to show it in a frame, so the heatmap is drawn on a blank page.",
    fix: "Add `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` on your site, then reload this page."
  },
  HEAT_E_DASHBOARD_FETCH: {
    code: "HEAT_E_DASHBOARD_FETCH",
    message: "The dashboard could not read heatmap data from the collector.",
    fix: "Check the Collector Base URL, that the collector is running, and that it allows CORS from the dashboard origin."
  }
} as const satisfies Record<string, LocalErrorDefinition>;
