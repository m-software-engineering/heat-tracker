import { sql } from "drizzle-orm";

/** DDL for projects and popular pages (#25), run by `autoMigrate`. */
type SqlDialect = "pg" | "mysql" | "sqlite";

/** CREATE TABLE for `pages`. MySQL keys on a stored SHA-256 of `path` (VARCHAR(1024) is too long for a key). */
export const buildCreatePagesSql = (dialect: SqlDialect) => {
  if (dialect === "mysql") {
    return sql.raw(`CREATE TABLE IF NOT EXISTS pages (
      project_id VARCHAR(64) NOT NULL, path VARCHAR(1024) NOT NULL, title VARCHAR(255) NOT NULL, title_ts BIGINT NOT NULL,
      path_hash BINARY(32) AS (UNHEX(SHA2(path, 256))) STORED,
      PRIMARY KEY (project_id, path_hash)
    );`);
  }
  const big = dialect === "pg" ? "BIGINT" : "INTEGER";
  return sql.raw(`CREATE TABLE IF NOT EXISTS pages (
    project_id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, title_ts ${big} NOT NULL,
    PRIMARY KEY (project_id, path)
  );`);
};

/**
 * Indexes for the pages and projects queries: (project, type, ts) covering path and session for the
 * pageview/click counts, and (project, ts) for "events in the last 24 h". MySQL has no INCLUDE and
 * no `IF NOT EXISTS` for indexes (the caller ignores ER_DUP_KEYNAME).
 */
export const buildCreatePagesIndexSql = (dialect: SqlDialect) => {
  const exists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
  const typeTs =
    dialect === "pg"
      ? "(project_id, type, ts) INCLUDE (path, session_id)"
      : dialect === "sqlite"
        ? "(project_id, type, ts, path, session_id)"
        : "(project_id, type, ts)";
  return [
    sql.raw(`CREATE INDEX ${exists}events_project_type_ts_idx ON events ${typeTs}`),
    sql.raw(`CREATE INDEX ${exists}events_project_ts_idx ON events (project_id, ts)`)
  ];
};
