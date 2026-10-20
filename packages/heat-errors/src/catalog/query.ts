import type { HttpErrorDefinition } from "../types";

/** Collector query API errors. */
export const QUERY_ERRORS = {
  HEAT_E_ROUTE_NOT_FOUND: {
    code: "HEAT_E_ROUTE_NOT_FOUND",
    status: 404,
    legacyCode: "not_found",
    message: "The collector has no route for this method and path.",
    fix: "Use POST /ingest or GET /api/projects, /api/projects/:projectId/{pages,heatmap,events,sessions}, /api/projects/by-key/:projectKey, /api/sessions/:sessionId, /api/metrics, or GET /healthz."
  },
  HEAT_E_ADMIN_TOKEN_MISSING: {
    code: "HEAT_E_ADMIN_TOKEN_MISSING",
    status: 401,
    legacyCode: "admin_token_missing",
    message: "The read API request has no admin token.",
    fix: "Send Authorization: Bearer <admin token>. Show the token with `docker compose exec collector heat-collector token` and paste it in the dashboard."
  },
  HEAT_E_ADMIN_TOKEN_INVALID: {
    code: "HEAT_E_ADMIN_TOKEN_INVALID",
    status: 401,
    legacyCode: "admin_token_invalid",
    message: "The admin token does not match this collector.",
    fix: "Show the current token with `docker compose exec collector heat-collector token` and paste it again in the dashboard."
  },
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
  HEAT_E_PROJECT_QUERY_FAILED: {
    code: "HEAT_E_PROJECT_QUERY_FAILED",
    status: 500,
    legacyCode: "project_query_failed",
    message: "The collector could not read the project.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_SESSION_DETAIL_FAILED: {
    code: "HEAT_E_SESSION_DETAIL_FAILED",
    status: 500,
    legacyCode: "session_detail_failed",
    message: "The collector could not read the session detail.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_QUERY_CURSOR: {
    code: "HEAT_E_QUERY_CURSOR",
    status: 400,
    legacyCode: "invalid_cursor",
    message: "Query parameter cursor is not a cursor this endpoint returned.",
    fix: "Send meta.nextCursor from the previous response unchanged, or omit cursor to start from the first page."
  },
  HEAT_E_PROJECT_NOT_FOUND: {
    code: "HEAT_E_PROJECT_NOT_FOUND",
    status: 404,
    legacyCode: "project_not_found",
    message: "No project has this id.",
    fix: "List projects with GET /api/projects and use one of the returned ids."
  },
  HEAT_E_PROJECTS_QUERY_FAILED: {
    code: "HEAT_E_PROJECTS_QUERY_FAILED",
    status: 500,
    legacyCode: "projects_query_failed",
    message: "The collector could not read projects.",
    fix: "Search collector logs for the requestId and check database connectivity."
  },
  HEAT_E_PAGES_QUERY_FAILED: {
    code: "HEAT_E_PAGES_QUERY_FAILED",
    status: 500,
    legacyCode: "pages_query_failed",
    message: "The collector could not read the project's pages.",
    fix: "Search collector logs for the requestId and check database connectivity."
  }
} as const satisfies Record<string, HttpErrorDefinition>;
