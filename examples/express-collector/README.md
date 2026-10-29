# Express Collector Example

Minimal Express app running `@m-software-engineering/heat-collector` with SQLite for local development.

## Quick setup

```bash
pnpm --filter ./examples/express-collector dev
```

Default ingestion endpoint: `http://localhost:4000/ingest`.

## Purpose

Use this example to validate SDK ingestion quickly and test query endpoints without external infrastructure.

## Cross-origin SDK

The example enables CORS on `/ingest` only (`app.use("/ingest", cors())`, same policy as the `heat-collector` bin), so a browser SDK on another origin can `POST /ingest` without `HEAT_E_INGEST_NETWORK` while read routes stay same-origin.
