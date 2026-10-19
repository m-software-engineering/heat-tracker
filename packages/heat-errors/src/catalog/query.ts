import type { HttpErrorDefinition } from "../types";

/** Collector query API errors. */
export const QUERY_ERRORS = {
  HEAT_E_QUERY_INVALID: {
    code: "HEAT_E_QUERY_INVALID",
    status: 400,
    legacyCode: "invalid_query",
    message: "A query parameter is invalid.",
    fix: "Correct the parameters listed in details.fieldErrors."
  },
  HEAT_E_QUERY_FROM: {
    code: "HEAT_E_QUERY_FROM",
    status: 400,
    legacyCode: "invalid_from",
    message: "Query parameter from is not a valid time.",
    fix: "Send from as epoch milliseconds (e.g. from=1700000000000) or an ISO date."
  },
  HEAT_E_QUERY_TO: {
    code: "HEAT_E_QUERY_TO",
    status: 400,
    legacyCode: "invalid_to",
    message: "Query parameter to is not a valid time.",
    fix: "Send to as epoch milliseconds (e.g. to=1700000000000) or an ISO date."
  },
  HEAT_E_INVALID_TIME_RANGE: {
    code: "HEAT_E_INVALID_TIME_RANGE",
    status: 400,
    legacyCode: "invalid_time_range",
    message: "Query parameter from is later than to.",
    fix: "Swap the values so from is less than or equal to to."
  },
  HEAT_E_HEATMAP_QUERY_FAILED: {
    code: "HEAT_E_HEATMAP_QUERY_FAILED",
    status: 500,
    legacyCode: "heatmap_query_failed",
    message: "The collector could not read heatmap data.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_EVENTS_QUERY_FAILED: {
    code: "HEAT_E_EVENTS_QUERY_FAILED",
    status: 500,
    legacyCode: "events_query_failed",
    message: "The collector could not read project events.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_SESSIONS_QUERY_FAILED: {
    code: "HEAT_E_SESSIONS_QUERY_FAILED",
    status: 500,
    legacyCode: "sessions_query_failed",
    message: "The collector could not read sessions.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_SESSION_DETAIL_FAILED: {
    code: "HEAT_E_SESSION_DETAIL_FAILED",
    status: 500,
    legacyCode: "session_detail_failed",
    message: "The collector could not read the session detail.",
    fix: "Search collector logs for the requestId and check database connectivity."
  }
} as const satisfies Record<string, HttpErrorDefinition>;
