import {
  projectSortKey,
  type PageCursor,
  type PageRow,
  type PageTitle,
  type ProjectCursor,
  type ProjectRow
} from "./pages-types";

/** MongoDB backend for projects and popular pages (#25); same results as `pages-sql.ts`. */
export const upsertPageTitlesMongo = async (db: any, projectId: string, titles: PageTitle[]) => {
  if (titles.length === 0) return;
  await db.collection("pages").bulkWrite(
    titles.map((t) => ({
      updateOne: {
        filter: { projectId, path: t.path },
        // Pipeline update: keep the stored title when it was seen later than this one.
        update: [
          {
            $set: {
              title: { $cond: [{ $gte: [t.ts, { $ifNull: ["$titleTs", -1] }] }, t.title, "$title"] },
              titleTs: { $max: [{ $ifNull: ["$titleTs", -1] }, t.ts] }
            }
          }
        ],
        upsert: true
      }
    })),
    { ordered: false }
  );
};

/**
 * Two queries: all projects, then one grouped read of the events; sorted like the SQL backend
 * (no events first, then most recent event) and keyset-paged in Node.
 */
export const listProjectsMongo = async (
  db: any,
  opts: { limit: number; after?: ProjectCursor; since: number }
): Promise<ProjectRow[]> => {
  const projects = await db.collection("projects").find({}).toArray();
  if (projects.length === 0) return [];
  const stats = await db
    .collection("events")
    .aggregate([
      {
        $group: {
          _id: "$projectId",
          last: { $max: "$ts" },
          recent: { $sum: { $cond: [{ $gte: ["$ts", opts.since] }, 1, 0] } }
        }
      }
    ])
    .toArray();
  const byId = new Map(stats.map((s: any) => [s._id, s]));
  const rows: ProjectRow[] = projects.map((p: any) => {
    const id = String(p.id ?? p._id);
    const s: any = byId.get(id);
    return {
      id,
      name: String(p.name),
      projectKey: String(p.key),
      createdAt: Number(p.createdAt),
      eventsLast24h: Number(s?.recent ?? 0),
      lastEventAt: s?.last == null ? null : Number(s.last)
    };
  });
  const ordered = rows.sort(
    (a, b) => projectSortKey(b) - projectSortKey(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const after = opts.after;
  const start = after
    ? ordered.filter((r) => projectSortKey(r) < after.k || (projectSortKey(r) === after.k && r.id > after.i))
    : ordered;
  return start.slice(0, opts.limit + 1);
};

export const projectExistsMongo = async (db: any, projectId: string) =>
  (await db.collection("projects").countDocuments({ id: projectId }, { limit: 1 })) > 0;

/** One aggregation: pageview sessions and clicks per path, keyset-paged, joined with `pages` titles. */
export const listPagesMongo = async (
  db: any,
  opts: { projectId: string; from: number; to: number; limit: number; after?: PageCursor }
): Promise<PageRow[]> => {
  const after = opts.after
    ? [
        {
          $match: { $or: [{ sessions: { $lt: opts.after.s } }, { sessions: opts.after.s, _id: { $gt: opts.after.p } }] }
        }
      ]
    : [];
  const rows = await db
    .collection("events")
    .aggregate([
      {
        $match: {
          projectId: opts.projectId,
          type: { $in: ["pageview", "click"] },
          ts: { $gte: opts.from, $lte: opts.to }
        }
      },
      {
        $group: {
          _id: { path: "$path", session: { $cond: [{ $eq: ["$type", "pageview"] }, "$sessionId", null] } },
          clicks: { $sum: { $cond: [{ $eq: ["$type", "click"] }, 1, 0] } }
        }
      },
      {
        $group: {
          _id: "$_id.path",
          sessions: { $sum: { $cond: [{ $eq: ["$_id.session", null] }, 0, 1] } },
          clicks: { $sum: "$clicks" }
        }
      },
      { $match: { sessions: { $gt: 0 } } },
      ...after,
      { $sort: { sessions: -1, _id: 1 } },
      { $limit: opts.limit + 1 },
      {
        $lookup: {
          from: "pages",
          let: { path: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$projectId", opts.projectId] }, { $eq: ["$path", "$$path"] }] } } },
            { $project: { _id: 0, title: 1 } }
          ],
          as: "page"
        }
      }
    ])
    .toArray();
  return rows.map((row: any) => ({
    path: String(row._id),
    title: row.page[0]?.title ?? null,
    sessions: Number(row.sessions),
    clicks: Number(row.clicks)
  }));
};
