---
"@m-software-engineering/heat-collector": minor
"@m-software-engineering/heat-errors": minor
---

Self-hosting groundwork (#24).

- New `heat-collector` binary: `heat-collector` (or `serve`) starts the collector on port 4000 from environment variables, fails fast with `HEAT_E_DB_CONFIG` (no `DATABASE_URL`) or `HEAT_E_DB_UNREACHABLE` (cause names host:port, never the password), generates an admin token once and keeps it in `HEAT_DATA_DIR/admin-token`, and prints a startup block with the dashboard URL, the token and `docker compose exec collector heat-collector token`. `heat-collector token` prints the token again.
- New opt-in `admin: { token }` collector option: `/api/*` then requires `Authorization: Bearer <token>` and answers 401 `HEAT_E_ADMIN_TOKEN_MISSING` / `HEAT_E_ADMIN_TOKEN_INVALID`. Without it the read API is unchanged.
- The server survives a dropped idle Postgres connection (logged as `HEAT_E_DB_CONNECTION_LOST`, the pool reconnects), names `ENOTFOUND` when the database host does not resolve, requires `HEAT_ADMIN_TOKEN` to be at least 32 characters, refuses an empty token file instead of crash-looping, and accepts `HEAT_TRUST_PROXY=true|false|<hops>|<addresses>`.
- New `GET /healthz` liveness route and `GET /api/projects/by-key/:projectKey`.
- Projects created by their first ingest are now named after the request `Origin` instead of `Default` (requests without an `Origin` still get `Default`).
- New error codes: `HEAT_E_ADMIN_TOKEN_MISSING`, `HEAT_E_ADMIN_TOKEN_INVALID`, `HEAT_E_PROJECT_QUERY_FAILED`, `HEAT_E_DB_UNREACHABLE`, `HEAT_E_ADMIN_TOKEN_STORE`, `HEAT_E_SERVER_LISTEN`, `HEAT_E_SERVER_COMMAND`, `HEAT_E_SERVER_CONFIG`, `HEAT_E_DB_CONNECTION_LOST`, `HEAT_E_ADMIN_TOKEN_FILE_INVALID`, `HEAT_E_ADMIN_TOKEN_WEAK`. `HEAT_E_DB_CONFIG`'s fix now mentions `DATABASE_URL`.
