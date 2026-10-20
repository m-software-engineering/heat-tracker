import type { HttpErrorDefinition } from "../types";

/** Collector ingestion and auth errors. */
export const INGEST_ERRORS = {
  HEAT_E_PAYLOAD_TOO_LARGE: {
    code: "HEAT_E_PAYLOAD_TOO_LARGE",
    status: 413,
    legacyCode: "payload_too_large",
    message: "The request body is larger than the collector accepts.",
    fix: "Lower batch.maxEvents in the SDK or raise ingestion.maxBodyBytes in createCollector()."
  },
  HEAT_E_INVALID_JSON: {
    code: "HEAT_E_INVALID_JSON",
    status: 400,
    legacyCode: "invalid_json",
    message: "The request body is not valid JSON.",
    fix: "Send Content-Type: application/json with a JSON.stringify()-ed body."
  },
  HEAT_E_UNSUPPORTED_MEDIA_TYPE: {
    code: "HEAT_E_UNSUPPORTED_MEDIA_TYPE",
    status: 415,
    legacyCode: "unsupported_media_type",
    message: "The ingest body is not sent as JSON.",
    fix: "Send the header Content-Type: application/json with the request."
  },
  HEAT_E_PROJECT_KEY_MISSING: {
    code: "HEAT_E_PROJECT_KEY_MISSING",
    status: 401,
    legacyCode: "missing_project_key",
    message: "The ingest request has no project key.",
    fix: "Set projectKey in init() or forward the x-project-key header through your proxy."
  },
  HEAT_E_PROJECT_KEY_INVALID: {
    code: "HEAT_E_PROJECT_KEY_INVALID",
    status: 400,
    legacyCode: "invalid_project_key",
    message: "The project key has characters the collector does not accept.",
    fix: "Use 1 to 128 characters from A-Z, a-z, 0-9, `_` and `-`, such as the key the dashboard generates (`pk_…`)."
  },
  HEAT_E_RATE_LIMITED: {
    code: "HEAT_E_RATE_LIMITED",
    status: 429,
    legacyCode: "rate_limited",
    message: "Too many ingest requests for this project key and IP.",
    fix: "Wait for the Retry-After header, or raise ingestion.rateLimit.max in createCollector()."
  },
  HEAT_E_JWT_MISSING: {
    code: "HEAT_E_JWT_MISSING",
    status: 401,
    legacyCode: "missing_jwt",
    message: "The collector requires a JWT and none was sent.",
    fix: "Call tracker.setAuthToken(jwt) before events are flushed."
  },
  HEAT_E_JWT_MALFORMED: {
    code: "HEAT_E_JWT_MALFORMED",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT is not a valid header.payload.signature token.",
    fix: "Pass the raw token string to setAuthToken(), without the Bearer prefix."
  },
  HEAT_E_JWT_ALG: {
    code: "HEAT_E_JWT_ALG",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT uses a signing algorithm the collector does not accept.",
    fix: "Issue tokens signed with RS256."
  },
  HEAT_E_JWKS_KEY_NOT_FOUND: {
    code: "HEAT_E_JWKS_KEY_NOT_FOUND",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "No key in the JWKS matches the JWT kid.",
    fix: "Publish the signing key in auth.jwksUrl or issue tokens with a kid that the JWKS lists."
  },
  HEAT_E_AUTH_JWKS_UNAVAILABLE: {
    code: "HEAT_E_AUTH_JWKS_UNAVAILABLE",
    status: 503,
    legacyCode: "jwks_unavailable",
    retryAfterSeconds: 30,
    message: "The collector could not download the JWKS, so it cannot verify tokens right now.",
    fix: "Retry after the Retry-After header; if it persists, check auth.jwksUrl and that the collector can reach it."
  },
  HEAT_E_JWT_BAD_SIGNATURE: {
    code: "HEAT_E_JWT_BAD_SIGNATURE",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT signature does not match the JWKS key.",
    fix: "Sign tokens with the private key whose public key is published at auth.jwksUrl."
  },
  HEAT_E_JWT_EXPIRED: {
    code: "HEAT_E_JWT_EXPIRED",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT has expired.",
    fix: "Refresh the token and call tracker.setAuthToken(newJwt)."
  },
  HEAT_E_JWT_NOT_ACTIVE: {
    code: "HEAT_E_JWT_NOT_ACTIVE",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT is not valid yet.",
    fix: "Check the nbf claim and the issuer clock."
  },
  HEAT_E_JWT_ISSUER: {
    code: "HEAT_E_JWT_ISSUER",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT issuer does not match the collector config.",
    fix: "Set auth.issuer to the token iss claim, or issue tokens from the configured issuer."
  },
  HEAT_E_JWT_AUDIENCE: {
    code: "HEAT_E_JWT_AUDIENCE",
    status: 401,
    legacyCode: "invalid_jwt",
    message: "The JWT audience does not include the collector audience.",
    fix: "Set auth.audience to a value in the token aud claim."
  },
  HEAT_E_PAYLOAD_SCHEMA: {
    code: "HEAT_E_PAYLOAD_SCHEMA",
    status: 400,
    legacyCode: "invalid_payload",
    message: "The ingest body does not match the expected schema.",
    fix: "Read details.fieldErrors and upgrade @m-software-engineering/heat-sdk to a version this collector supports."
  },
  HEAT_E_HOOK_PAYLOAD: {
    code: "HEAT_E_HOOK_PAYLOAD",
    status: 400,
    legacyCode: "invalid_hook_payload",
    message: "hooks.onBeforeInsert returned a payload that does not match the schema.",
    fix: "Return the received payload (modified) from hooks.onBeforeInsert; read details.fieldErrors."
  },
  HEAT_E_INGEST_FAILED: {
    code: "HEAT_E_INGEST_FAILED",
    status: 500,
    legacyCode: "ingest_failed",
    message: "The collector could not store the batch.",
    fix: "Search collector logs for the requestId and check database connectivity."
  }
} as const satisfies Record<string, HttpErrorDefinition>;
