import type express from "express";
import { QUERY_ERRORS } from "@m-software-engineering/heat-errors";
import type { DbContext } from "./db";
import type { Logger } from "./logger";
import { fieldErrors, queryCause, sendError } from "./http-errors";
import { pagesQuerySchema, projectsQuerySchema } from "./validation";
import { listPagesMongo, listProjectsMongo, projectExistsMongo, upsertPageTitlesMongo } from "./pages-mongo";
import { listPagesSql, listProjectsSql, projectExistsSql, upsertPageTitlesSql } from "./pages-sql";
import type { PageCursor, PageTitle, ProjectCursor } from "./pages-types";

/**
 * Projects and popular pages (#25): `GET /api/projects` and `GET /api/projects/:projectId/pages`.
 * Each request runs at most two database queries (pages: project lookup + one grouped read).
 */
const DAY_MS = 86_400_000;
const DEFAULT_PAGES_WINDOW_MS = 7 * DAY_MS;

/** Latest titled pageview per path in an ingest batch (already sanitized by `sanitizePayloadPaths`). */
export const pageTitlesOf = (events: any[]): PageTitle[] => {
  const latest = new Map<string, PageTitle>();
  for (const event of events) {
    if (event.type !== "pageview" || !event.title) continue;
    const seen = latest.get(event.path);
    if (!seen || event.ts >= seen.ts) latest.set(event.path, { path: event.path, title: event.title, ts: event.ts });
  }
  return [...latest.values()];
};

export const upsertPageTitles = (ctx: DbContext, projectId: string, titles: PageTitle[]) =>
  ctx.dialect === "mongodb"
    ? upsertPageTitlesMongo(ctx.db, projectId, titles)
    : upsertPageTitlesSql(ctx, projectId, titles);

const encodeCursor = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const decodeCursor = <T>(raw: string, valid: (value: any) => boolean): T | undefined => {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return valid(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
};

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isProjectCursor = (v: any) => isNum(v?.c) && typeof v?.i === "string";
const isPageCursor = (v: any) => isNum(v?.s) && typeof v?.p === "string" && isNum(v?.f) && isNum(v?.t);

const timeCause = (param: "from" | "to", value?: string) =>
  `${param}: received ${JSON.stringify(value)} (expected epoch milliseconds or an ISO date)`;

type TimeParser = (value?: string) => number | undefined;

export const registerPageRoutes = (
  apiRouter: express.Router,
  ctx: DbContext,
  logger: Logger,
  parseTime: TimeParser,
  markNoStore: (res: express.Response) => void
) => {
  apiRouter.get("/api/projects", async (req, res) => {
    const parsed = projectsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_INVALID, queryCause(parsed.error, req.query), {
        details: { fieldErrors: fieldErrors(parsed.error) }
      });
    }
    const { limit, cursor } = parsed.data;
    const after = cursor ? decodeCursor<ProjectCursor>(cursor, isProjectCursor) : undefined;
    if (cursor && !after) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_CURSOR, `cursor=${JSON.stringify(cursor)}`);
    }
    try {
      const opts = { limit, after, since: Date.now() - DAY_MS };
      const rows = ctx.dialect === "mongodb" ? await listProjectsMongo(ctx.db, opts) : await listProjectsSql(ctx, opts);
      const projects = rows.slice(0, limit).map((p) => ({ ...p, receivingData: p.eventsLast24h > 0 }));
      const last = projects[projects.length - 1];
      markNoStore(res);
      return res.json({
        projects,
        meta: {
          count: projects.length,
          limit,
          nextCursor: rows.length > limit ? encodeCursor({ c: last.createdAt, i: last.id }) : null
        }
      });
    } catch (err) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_PROJECTS_QUERY_FAILED, "database read failed", {
        logLevel: "error",
        original: err
      });
    }
  });

  apiRouter.get("/api/projects/:projectId/pages", async (req, res) => {
    const parsed = pagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_INVALID, queryCause(parsed.error, req.query), {
        details: { fieldErrors: fieldErrors(parsed.error) }
      });
    }
    const query = parsed.data;
    const projectId = req.params.projectId;
    const after = query.cursor ? decodeCursor<PageCursor>(query.cursor, isPageCursor) : undefined;
    if (query.cursor && !after) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_CURSOR, `cursor=${JSON.stringify(query.cursor)}`);
    }

    // A cursor carries its window, so later pages stay consistent while "now" moves.
    let from = after?.f;
    let to = after?.t;
    if (!after) {
      to = query.to === undefined ? Date.now() : parseTime(query.to);
      if (to === undefined) {
        return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_TO, timeCause("to", query.to));
      }
      from = query.from === undefined ? to - DEFAULT_PAGES_WINDOW_MS : parseTime(query.from);
      if (from === undefined) {
        return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_QUERY_FROM, timeCause("from", query.from));
      }
      if (from > to) {
        return sendError(
          logger,
          req,
          res,
          QUERY_ERRORS.HEAT_E_INVALID_TIME_RANGE,
          `from=${from} is later than to=${to}`,
          {
            details: { from, to }
          }
        );
      }
    }

    try {
      const mongo = ctx.dialect === "mongodb";
      const exists = mongo ? await projectExistsMongo(ctx.db, projectId) : await projectExistsSql(ctx, projectId);
      if (!exists) {
        return sendError(
          logger,
          req,
          res,
          QUERY_ERRORS.HEAT_E_PROJECT_NOT_FOUND,
          `projectId=${JSON.stringify(projectId)}`
        );
      }
      const opts = { projectId, from: from!, to: to!, limit: query.limit, after };
      const rows = mongo ? await listPagesMongo(ctx.db, opts) : await listPagesSql(ctx, opts);
      const pages = rows.slice(0, query.limit).map((row) => ({
        path: row.path,
        // Pages that never sent a title are listed by path.
        title: row.title || row.path,
        hasTitle: Boolean(row.title),
        sessions: row.sessions,
        clicks: row.clicks
      }));
      const last = pages[pages.length - 1];
      markNoStore(res);
      return res.json({
        pages,
        meta: {
          count: pages.length,
          limit: query.limit,
          projectId,
          range: { from, to },
          nextCursor:
            rows.length > query.limit ? encodeCursor({ s: last.sessions, p: last.path, f: from, t: to }) : null
        }
      });
    } catch (err) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_PAGES_QUERY_FAILED, "database read failed", {
        logLevel: "error",
        context: { projectId },
        original: err
      });
    }
  });
};
