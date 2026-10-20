import { sql, type SQL } from "drizzle-orm";
import type { DbContext } from "./db";
import {
  NO_EVENTS_SORT_KEY,
  type PageCursor,
  type PageRow,
  type PageTitle,
  type ProjectCursor,
  type ProjectRow
} from "./pages-types";

/**
 * Projects and popular pages (#25) on Postgres, MySQL and SQLite. `pages` keeps the latest-seen title
 * per (project, path); counts come from `events` in one grouped query per request.
 */

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

/**
 * One query: projects with no events first, then by most recent event (Margot, #64), with their event
 * count since `since`, last event ts and project key (the route is admin-only). Keyset on (sort key, id).
 */
export const listProjectsSql = async (
  ctx: DbContext,
  opts: { limit: number; after?: ProjectCursor; since: number }
): Promise<ProjectRow[]> => {
  const sortKey = sql`COALESCE(q.last_event_at, ${NO_EVENTS_SORT_KEY})`;
  const after = opts.after
    ? sql`WHERE ${sortKey} < ${opts.after.k} OR (${sortKey} = ${opts.after.k} AND q.id > ${opts.after.i})`
    : sql``;
  const keyColumn = sql.raw(ctx.dialect === "mysql" ? "p.`key`" : "p.key");
  const rows = await rowsOf(
    ctx,
    sql`SELECT * FROM (SELECT p.id AS id, p.name AS name, ${keyColumn} AS project_key, p.created_at AS created_at,
      (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.ts >= ${opts.since}) AS events_24h,
      (SELECT MAX(e.ts) FROM events e WHERE e.project_id = p.id) AS last_event_at
      FROM projects p) q ${after} ORDER BY ${sortKey} DESC, q.id ASC LIMIT ${opts.limit + 1}`
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    projectKey: String(row.project_key),
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
