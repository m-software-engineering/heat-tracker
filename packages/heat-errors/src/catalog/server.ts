import type { LocalErrorDefinition } from "../types";

/** Collector setup, database, and CLI errors (no HTTP status). */
export const SERVER_ERRORS = {
  HEAT_E_DB_CONFIG: {
    code: "HEAT_E_DB_CONFIG",
    message: "The database config has neither a connection string nor a client.",
    fix: "Pass db.connectionString or db.client to createCollector()."
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
    fix: "Check DATABASE_URL (or SQLITE_FILE) and that the database user can create tables."
  }
} as const satisfies Record<string, LocalErrorDefinition>;
