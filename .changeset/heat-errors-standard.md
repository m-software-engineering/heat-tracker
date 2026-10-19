---
"@m-software-engineering/heat-errors": minor
"@m-software-engineering/heat-collector": minor
"@m-software-engineering/heat-sdk": minor
---

**BREAKING (collector error responses):** the top-level `error` string is removed. `error` is now a `HeatError` object.

```js
// before
showToast(body.error); // "invalid jwt"
// after
showToast(body.error.message); // "The JWT has expired."
```

**BREAKING (collector auth):** when the JWKS cannot be downloaded, the collector now returns HTTP 503 `HEAT_E_AUTH_JWKS_UNAVAILABLE` with `Retry-After: 30`. It used to return 401 `invalid_jwt`.

Add `@m-software-engineering/heat-errors`: one `HeatError` shape (`HEAT_E_*` code, message, cause, fix, docs, requestId, status, details) used by the SDK, collector, CLI, and DB layer. The top-level `code`, `message`, `requestId`, and `details` fields are deprecated and will be removed in the next major version. Read `error.code`, `error.message`, `error.requestId`, and `error.details` instead. Error responses send `Deprecation: true`, and the collector logs one deprecation warning per process. JWT failures have specific codes. Query validation errors name the parameter, the received value, and the expected format in `details.fieldErrors`. Logs mask project keys and truncate IPs. `heat-collector-migrate` reports failures as driver error class + code + host (never credentials) and adds the masked raw driver message only with `--verbose`. The SDK adds `onError(err)` and `debug` (logs each code once per page load). See `docs/errors.md`.
