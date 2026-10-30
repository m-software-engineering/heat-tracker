import type { LocalErrorDefinition } from "../types";

/** Collector setup, database, and CLI errors (no HTTP status). */
export const SERVER_ERRORS = {
  HEAT_E_DB_CONFIG: {
    code: "HEAT_E_DB_CONFIG",
    message: "The database config has neither a connection string nor a client.",
    fix: "Set DATABASE_URL for the heat-collector server (docker compose sets it), or pass db.connectionString or db.client to createCollector()."
  },
  HEAT_E_DB_DRIVER_MISSING: {
    code: "HEAT_E_DB_DRIVER_MISSING",
    message: "The database driver for the configured dialect is not installed.",
    fix: "Install the driver named in the cause next to the collector, for example `npm install pg`. On Node.js 20, SQLite needs `better-sqlite3@11`."
  },
  HEAT_E_DB_UNREACHABLE: {
    code: "HEAT_E_DB_UNREACHABLE",
    message: "The collector could not connect to the database.",
    fix: "Check that the database is running and reachable at the host and port in DATABASE_URL, for example with `docker compose ps postgres`."
  },
  HEAT_E_DB_CONNECTION_LOST: {
    code: "HEAT_E_DB_CONNECTION_LOST",
    message: "An idle database connection was closed; the collector reconnects on the next query.",
    fix: "Nothing to do after a database restart. If it repeats, check database health and the network between collector and database (`docker compose ps postgres`)."
  },
  HEAT_E_ADMIN_TOKEN_FILE_INVALID: {
    code: "HEAT_E_ADMIN_TOKEN_FILE_INVALID",
    message: "The admin token file holds no token.",
    fix: "Delete it so a new token is generated on the next start: `docker compose run --rm collector rm /data/admin-token`, then `docker compose up -d` and paste the new token in the dashboard."
  },
  HEAT_E_ADMIN_TOKEN_WEAK: {
    code: "HEAT_E_ADMIN_TOKEN_WEAK",
    message: "HEAT_ADMIN_TOKEN is too short to be safe.",
    fix: "Use at least 32 random characters, for example `openssl rand -base64 32`, or unset HEAT_ADMIN_TOKEN to use the generated token."
  },
  HEAT_E_SERVER_CONFIG: {
    code: "HEAT_E_SERVER_CONFIG",
    message: "A heat-collector environment variable has an invalid value.",
    fix: "Correct the variable named in the cause; see the heat-collector README for accepted values."
  },
  HEAT_E_ADMIN_TOKEN_STORE: {
    code: "HEAT_E_ADMIN_TOKEN_STORE",
    message: "The collector could not read or write the admin token file.",
    fix: "Mount a writable volume at HEAT_DATA_DIR (default /data), or set HEAT_ADMIN_TOKEN."
  },
  HEAT_E_SERVER_LISTEN: {
    code: "HEAT_E_SERVER_LISTEN",
    message: "The collector could not listen on its port.",
    fix: "Free the port or set PORT to another one; in docker compose, change the published port in docker-compose.yml."
  },
  HEAT_E_SERVER_COMMAND: {
    code: "HEAT_E_SERVER_COMMAND",
    message: "heat-collector does not know this command.",
    fix: "Run `heat-collector` (or `heat-collector serve`) to start the server, or `heat-collector token` to print the admin token."
  },
  HEAT_E_ROLLUP_CATCH_UP: {
    code: "HEAT_E_ROLLUP_CATCH_UP",
    message: "The collector could not count new events into the heatmap rollup; heatmaps read raw events until it can.",
    fix: "Check database connectivity and permissions on events and heatmap_rollup; the next catch-up retries automatically."
  },
  HEAT_E_DB_EXECUTE: {
    code: "HEAT_E_DB_EXECUTE",
    message: "The database client cannot run raw SQL statements.",
    fix: "Pass a drizzle database that exposes execute(), run(), or query() as db.db."
  },
  HEAT_E_DB_PROJECT_ID: {
    code: "HEAT_E_DB_PROJECT_ID",
    message: "A stored project document has no id.",
    fix: "Set the id field on the document in the projects collection."
  },
  HEAT_E_CLI_DIALECT: {
    code: "HEAT_E_CLI_DIALECT",
    message: "HEAT_DIALECT is not a supported database dialect.",
    fix: "Set HEAT_DIALECT to one of sqlite, pg, mysql, mongodb."
  },
  HEAT_E_MIGRATION_FAILED: {
    code: "HEAT_E_MIGRATION_FAILED",
    message: "Database migrations did not complete.",
    fix: "Check DATABASE_URL (or SQLITE_FILE) and that the database user can create tables; rerun with --verbose for the driver message (password masked)."
  }
} as const satisfies Record<string, LocalErrorDefinition>;
