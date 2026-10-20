import { sql, type SQL } from "drizzle-orm";
import type { DbContext } from "./db";
import type { PageCursor, PageRow, PageTitle, ProjectCursor, ProjectRow } from "./pages-types";

/**
 * Projects and popular pages (#25) on Postgres, MySQL and SQLite. `pages` keeps the latest-seen title
 * per (project, path); counts come from `events` in one grouped query per request.
 */
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

const rowsOf = async (ctx: DbContext, query: SQL): Promise<any[]> => {
  if (ctx.dialect === "sqlite") return ctx.db.all(query);
  const result = await ctx.db.execute(query);
  return ctx.dialect === "mysql" ? result[0] : result.rows;
};

/** Writes the latest title per path; an older pageview (smaller ts) never overwrites a newer title. */
export const upsertPageTitlesSql = async (ctx: DbContext, projectId: string, titles: PageTitle[]) => {
  if (titles.length === 0) return;
  const values = sql.join(
    titles.map((t) => sql`(${projectId}, ${t.path}, ${t.title}, ${t.ts})`),
    sql`, `
  );
  const query =
    ctx.dialect === "mysql"
      ? sql`INSERT INTO pages (project_id, path, title, title_ts) VALUES ${values}
          ON DUPLICATE KEY UPDATE title = IF(VALUES(title_ts) >= title_ts, VALUES(title), title),
          title_ts = GREATEST(title_ts, VALUES(title_ts))`
      : sql`INSERT INTO pages (project_id, path, title, title_ts) VALUES ${values}
          ON CONFLICT (project_id, path) DO UPDATE SET title = excluded.title, title_ts = excluded.title_ts
          WHERE excluded.title_ts >= pages.title_ts`;
  if (ctx.dialect === "sqlite") ctx.db.run(query);
  else await ctx.db.execute(query);
};

/** One query: projects in (createdAt, id) order with their event count since `since` and last event ts. */
export const listProjectsSql = async (
  ctx: DbContext,
  opts: { limit: number; after?: ProjectCursor; since: number }
): Promise<ProjectRow[]> => {
  const after = opts.after
    ? sql`WHERE p.created_at > ${opts.after.c} OR (p.created_at = ${opts.after.c} AND p.id > ${opts.after.i})`
    : sql``;
  const rows = await rowsOf(
    ctx,
    sql`SELECT p.id AS id, p.name AS name, p.created_at AS created_at,
      (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.ts >= ${opts.since}) AS events_24h,
      (SELECT MAX(e.ts) FROM events e WHERE e.project_id = p.id) AS last_event_at
      FROM projects p ${after} ORDER BY p.created_at ASC, p.id ASC LIMIT ${opts.limit + 1}`
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: Number(row.created_at),
    eventsLast24h: Number(row.events_24h ?? 0),
    lastEventAt: row.last_event_at == null ? null : Number(row.last_event_at)
  }));
};

export const projectExistsSql = async (ctx: DbContext, projectId: string) =>
  (await rowsOf(ctx, sql`SELECT id FROM projects WHERE id = ${projectId}`)).length > 0;

/**
 * One query: paths with at least one pageview in [from, to], with distinct pageview sessions, clicks and
 * the stored title, ordered by sessions desc then path (keyset cursor on that pair).
 */
export const listPagesSql = async (
  ctx: DbContext,
  opts: { projectId: string; from: number; to: number; limit: number; after?: PageCursor }
): Promise<PageRow[]> => {
  const { projectId, from, to } = opts;
  const window = sql`project_id = ${projectId} AND ts >= ${from} AND ts <= ${to}`;
  const joinPage =
    ctx.dialect === "mysql"
      ? sql`pg.project_id = ${projectId} AND pg.path_hash = UNHEX(SHA2(s.path, 256))`
      : sql`pg.project_id = ${projectId} AND pg.path = s.path`;
  const after = opts.after
    ? sql`WHERE s.sessions < ${opts.after.s} OR (s.sessions = ${opts.after.s} AND s.path > ${opts.after.p})`
    : sql``;
  const rows = await rowsOf(
    ctx,
    sql`WITH s AS (
        SELECT path, COUNT(*) AS sessions FROM (
          SELECT DISTINCT path, session_id FROM events WHERE ${window} AND type = 'pageview'
        ) v GROUP BY path
      ), c AS (
        SELECT path, COUNT(*) AS clicks FROM events WHERE ${window} AND type = 'click' GROUP BY path
      )
      SELECT s.path AS path, s.sessions AS sessions, COALESCE(c.clicks, 0) AS clicks, pg.title AS title
      FROM s LEFT JOIN c ON c.path = s.path LEFT JOIN pages pg ON ${joinPage}
      ${after} ORDER BY s.sessions DESC, s.path ASC LIMIT ${opts.limit + 1}`
  );
  return rows.map((row) => ({
    path: String(row.path),
    title: row.title == null ? null : String(row.title),
    sessions: Number(row.sessions),
    clicks: Number(row.clicks)
  }));
};
