# Heat Tracker errors

<!-- Generated from packages/heat-errors/src/catalog. Run `corepack pnpm -C packages/heat-errors docs:errors`. -->

Every SDK, collector, CLI, and database error has this shape:

```ts
type HeatError = {
  code: `HEAT_E_${string}`;
  message: string;
  cause: string;
  fix: string;
  docs: string;
  requestId?: string;
  status?: number;
  details?: Record<string, unknown>;
};
```

Collector responses wrap it as `{ "error": HeatError }`.
Validation errors put per-field messages in `details.fieldErrors` (`{ "<param>": "<message>" }`).

## Migrating from legacy fields

The top-level `code`, `message`, `requestId`, and `details` fields are deprecated and will be removed in the
next major version. While a response still carries them it also sends `Deprecation: true` and a `Link` to this
section, and the collector logs one deprecation warning per process.

| Deprecated field | Read instead      |
| ---------------- | ----------------- |
| `code`           | `error.code`      |
| `message`        | `error.message`   |
| `requestId`      | `error.requestId` |
| `details`        | `error.details`   |

Breaking: the old top-level `error` string is gone; `error` is now the object.

```js
// before
console.log(body.error); // "invalid jwt"
// after
console.log(body.error.message); // "The JWT has expired."
```

## HEAT_E_CONFIG_MISSING

- Message: init() is missing a required config key.
- Fix: Pass both keys: init({ endpoint: "https://collector.example.com/ingest", projectKey: "pk_live_a1b2" }).

## HEAT_E_NOT_BROWSER

- Message: init() was called outside a browser, for example during server-side rendering.
- Fix: Call init() inside useEffect or behind typeof window !== "undefined".

## HEAT_E_INGEST_HTTP

- Message: The collector rejected an event batch.
- Fix: Read the collector error code in details.collector; 401 means check projectKey or setAuthToken(), 413 means lower batch.maxEvents.

## HEAT_E_INGEST_NETWORK

- Message: The SDK could not reach the collector; the batch will be retried.
- Fix: Check that endpoint is reachable from the browser and allows CORS for x-project-key.

## HEAT_E_PAYLOAD_TOO_LARGE

- HTTP status: 413
- Legacy code: `payload_too_large`
- Message: The request body is larger than the collector accepts.
- Fix: Lower batch.maxEvents in the SDK or raise ingestion.maxBodyBytes in createCollector().

## HEAT_E_INVALID_JSON

- HTTP status: 400
- Legacy code: `invalid_json`
- Message: The request body is not valid JSON.
- Fix: Send Content-Type: application/json with a JSON.stringify()-ed body.

## HEAT_E_UNSUPPORTED_MEDIA_TYPE

- HTTP status: 415
- Legacy code: `unsupported_media_type`
- Message: The ingest body is not sent as JSON.
- Fix: Send the header Content-Type: application/json with the request.

## HEAT_E_PROJECT_KEY_MISSING

- HTTP status: 401
- Legacy code: `missing_project_key`
- Message: The ingest request has no project key.
- Fix: Set projectKey in init() or forward the x-project-key header through your proxy.

## HEAT_E_RATE_LIMITED

- HTTP status: 429
- Legacy code: `rate_limited`
- Message: Too many ingest requests for this project key and IP.
- Fix: Wait for the Retry-After header, or raise ingestion.rateLimit.max in createCollector().

## HEAT_E_JWT_MISSING

- HTTP status: 401
- Legacy code: `missing_jwt`
- Message: The collector requires a JWT and none was sent.
- Fix: Call tracker.setAuthToken(jwt) before events are flushed.

## HEAT_E_JWT_MALFORMED

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT is not a valid header.payload.signature token.
- Fix: Pass the raw token string to setAuthToken(), without the Bearer prefix.

## HEAT_E_JWT_ALG

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT uses a signing algorithm the collector does not accept.
- Fix: Issue tokens signed with RS256.

## HEAT_E_JWKS_KEY_NOT_FOUND

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: No key in the JWKS matches the JWT kid.
- Fix: Publish the signing key in auth.jwksUrl or issue tokens with a kid that the JWKS lists.

## HEAT_E_AUTH_JWKS_UNAVAILABLE

- HTTP status: 503
- Legacy code: `jwks_unavailable`
- Retry-After: 30 seconds
- Message: The collector could not download the JWKS, so it cannot verify tokens right now.
- Fix: Retry after the Retry-After header; if it persists, check auth.jwksUrl and that the collector can reach it.

## HEAT_E_JWT_BAD_SIGNATURE

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT signature does not match the JWKS key.
- Fix: Sign tokens with the private key whose public key is published at auth.jwksUrl.

## HEAT_E_JWT_EXPIRED

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT has expired.
- Fix: Refresh the token and call tracker.setAuthToken(newJwt).

## HEAT_E_JWT_NOT_ACTIVE

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT is not valid yet.
- Fix: Check the nbf claim and the issuer clock.

## HEAT_E_JWT_ISSUER

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT issuer does not match the collector config.
- Fix: Set auth.issuer to the token iss claim, or issue tokens from the configured issuer.

## HEAT_E_JWT_AUDIENCE

- HTTP status: 401
- Legacy code: `invalid_jwt`
- Message: The JWT audience does not include the collector audience.
- Fix: Set auth.audience to a value in the token aud claim.

## HEAT_E_PAYLOAD_SCHEMA

- HTTP status: 400
- Legacy code: `invalid_payload`
- Message: The ingest body does not match the expected schema.
- Fix: Read details.fieldErrors and upgrade @m-software-engineering/heat-sdk to a version this collector supports.

## HEAT_E_HOOK_PAYLOAD

- HTTP status: 400
- Legacy code: `invalid_hook_payload`
- Message: hooks.onBeforeInsert returned a payload that does not match the schema.
- Fix: Return the received payload (modified) from hooks.onBeforeInsert; read details.fieldErrors.

## HEAT_E_INGEST_FAILED

- HTTP status: 500
- Legacy code: `ingest_failed`
- Message: The collector could not store the batch.
- Fix: Search collector logs for the requestId and check database connectivity.

## HEAT_E_ROUTE_NOT_FOUND

- HTTP status: 404
- Legacy code: `not_found`
- Message: The collector has no route for this method and path.
- Fix: Use POST /ingest or GET /api/projects/:projectId/{heatmap,events,sessions}, /api/sessions/:sessionId, /api/metrics.

## HEAT_E_QUERY_INVALID

- HTTP status: 400
- Legacy code: `invalid_query`
- Message: A query parameter is invalid.
- Fix: Correct the parameters listed in details.fieldErrors.

## HEAT_E_QUERY_FROM

- HTTP status: 400
- Legacy code: `invalid_from`
- Message: Query parameter from is not a valid time.
- Fix: Send from as epoch milliseconds (e.g. from=1700000000000) or an ISO date.

## HEAT_E_QUERY_TO

- HTTP status: 400
- Legacy code: `invalid_to`
- Message: Query parameter to is not a valid time.
- Fix: Send to as epoch milliseconds (e.g. to=1700000000000) or an ISO date.

## HEAT_E_INVALID_TIME_RANGE

- HTTP status: 400
- Legacy code: `invalid_time_range`
- Message: Query parameter from is later than to.
- Fix: Swap the values so from is less than or equal to to.

## HEAT_E_HEATMAP_QUERY_FAILED

- HTTP status: 500
- Legacy code: `heatmap_query_failed`
- Message: The collector could not read heatmap data.
- Fix: Search collector logs for the requestId and check database connectivity.

## HEAT_E_EVENTS_QUERY_FAILED

- HTTP status: 500
- Legacy code: `events_query_failed`
- Message: The collector could not read project events.
- Fix: Search collector logs for the requestId and check database connectivity.

## HEAT_E_SESSIONS_QUERY_FAILED

- HTTP status: 500
- Legacy code: `sessions_query_failed`
- Message: The collector could not read sessions.
- Fix: Search collector logs for the requestId and check database connectivity.

## HEAT_E_SESSION_DETAIL_FAILED

- HTTP status: 500
- Legacy code: `session_detail_failed`
- Message: The collector could not read the session detail.
- Fix: Search collector logs for the requestId and check database connectivity.

## HEAT_E_DB_CONFIG

- Message: The database config has neither a connection string nor a client.
- Fix: Pass db.connectionString or db.client to createCollector().

## HEAT_E_DB_EXECUTE

- Message: The database client cannot run raw SQL statements.
- Fix: Pass a drizzle database that exposes execute(), run(), or query() as db.db.

## HEAT_E_DB_PROJECT_ID

- Message: A stored project document has no id.
- Fix: Set the id field on the document in the projects collection.

## HEAT_E_CLI_DIALECT

- Message: HEAT_DIALECT is not a supported database dialect.
- Fix: Set HEAT_DIALECT to one of sqlite, pg, mysql, mongodb.

## HEAT_E_MIGRATION_FAILED

- Message: Database migrations did not complete.
- Fix: Check DATABASE_URL (or SQLITE_FILE) and that the database user can create tables; rerun with --verbose for the driver message (password masked).
