import type { Router } from "express";
import { eq } from "drizzle-orm";
import { QUERY_ERRORS } from "@m-software-engineering/heat-errors";
import type { DbContext } from "./db";
import { sendError } from "./http-errors";
import type { Logger } from "./logger";

export type ProjectSummary = { id: string; name: string; createdAt: number };

const findProjectByKey = async (ctx: DbContext, key: string): Promise<ProjectSummary | null> => {
  if (ctx.dialect === "mongodb") {
    const doc = await ctx.db.collection("projects").findOne({ key });
    if (!doc) return null;
    return { id: String(doc.id ?? doc._id), name: String(doc.name ?? "Default"), createdAt: Number(doc.createdAt) };
  }
  const { projects } = ctx.schema as any;
  const rows = await ctx.db.select().from(projects).where(eq(projects.key, key)).limit(1);
  if (rows.length === 0) return null;
  return { id: rows[0].id, name: rows[0].name, createdAt: Number(rows[0].createdAt) };
};

/**
 * `GET /api/projects/by-key/:projectKey` → `{ project: ProjectSummary | null }`. `null` means no
 * event has arrived yet for that key (the project is created by its first ingest); the dashboard
 * polls it to show "Waiting for your first event…".
 */
export const mountProjectsApi = (apiRouter: Router, ctx: DbContext, logger: Logger) => {
  apiRouter.get("/api/projects/by-key/:projectKey", async (req, res) => {
    try {
      const project = await findProjectByKey(ctx, req.params.projectKey);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ project });
    } catch (err) {
      return sendError(logger, req, res, QUERY_ERRORS.HEAT_E_PROJECT_QUERY_FAILED, "database read failed", {
        logLevel: "error",
        original: err
      });
    }
  });
};
