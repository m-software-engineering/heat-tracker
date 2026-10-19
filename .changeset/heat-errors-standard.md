---
"@m-software-engineering/heat-errors": minor
"@m-software-engineering/heat-collector": minor
"@m-software-engineering/heat-sdk": minor
---

Add `@m-software-engineering/heat-errors`: one `HeatError` shape (`HEAT_E_*` code, message, cause, fix, docs, requestId, status, details) used by the SDK, collector, CLI, and DB layer. Collector error responses now carry `{ error: HeatError }`; top-level `code`, `message`, `requestId`, and `details` remain for one minor version and are deprecated (the old top-level `error` string is replaced by the object). JWT failures are split into specific codes, query validation errors name the parameter, received value, and expected format in `details.fieldErrors`, and logs mask project keys and truncate IPs. The SDK adds `onError(err)` and `debug` (logs each code once per page load). See `docs/errors.md`.
