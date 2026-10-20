import type { DbContext } from "./db";
import type { HeatmapBackend, HeatmapFilter, HeatmapGrid } from "./heatmap-types";
import { safeParseMetaJson } from "./meta-json";

const match = (filter: HeatmapFilter) => {
  const query: Record<string, unknown> = { projectId: filter.projectId, ts: { $gte: filter.from, $lte: filter.to } };
  if (filter.type !== "all") query.type = filter.type;
  if (filter.path) query.path = filter.path;
  return query;
};

// Documents omit absent coordinates, so non-numeric x/y are skipped (the old path's NaN check).
const isScroll = { $and: [{ $eq: ["$type", "scroll"] }, { $gt: ["$scrollDepth", null] }] };

const bucketOf = (value: unknown, size: number, max: number) => ({
  $min: [max, { $max: [0, { $floor: { $divide: [value, size] } }] }]
});

export const aggregateMongo = (ctx: DbContext): HeatmapBackend => {
  const events = ctx.db.collection("events");

  return {
    summary: async (filter) => {
      const rows = await events
        .aggregate([
          { $match: match(filter) },
          {
            $group: {
              _id: "$type",
              count: { $sum: 1 },
              maxY: { $max: { $cond: [isScroll, null, "$y"] } }
            }
          }
        ])
        .toArray();
      const ys = rows.map((row: any) => row.maxY).filter((y: unknown): y is number => typeof y === "number");
      return {
        typeBreakdown: Object.fromEntries(rows.map((row: any) => [String(row._id ?? "unknown"), row.count])),
        maxY: ys.length > 0 ? Math.max(...ys) : null
      };
    },

    // Mongo stores meta as a JSON string the pipeline cannot parse, so the sampled viewports are
    // parsed in Node from a projected cursor, one document at a time.
    viewportGroups: async (filter, limit, visit) => {
      const cursor = events
        .find(match(filter), { projection: { _id: 0, metaJson: 1 } })
        .sort({ ts: -1 })
        .limit(limit);
      for await (const doc of cursor) {
        const meta = safeParseMetaJson(doc.metaJson);
        const nested = meta.meta as Record<string, unknown> | undefined;
        const viewport = meta.viewport as Record<string, unknown> | undefined;
        visit({ explicit: nested?.viewportBucket, w: viewport?.w, h: viewport?.h, count: 1 });
      }
    },

    buckets: async (filter, grid: HeatmapGrid) => {
      const max = grid.resolution - 1;
      const depth = { $cond: [{ $gt: ["$scrollDepth", 100] }, { $divide: ["$scrollDepth", 100] }, "$scrollDepth"] };
      const scrollY = { $floor: { $add: [{ $multiply: [{ $divide: [depth, 100] }, grid.renderHeight] }, 0.5] } };
      const x = { $cond: [isScroll, 0, "$x"] };
      const y = { $cond: [isScroll, scrollY, "$y"] };
      const rows = await events
        .aggregate([
          { $match: match(filter) },
          { $project: { x, y } },
          { $match: { $expr: { $and: [{ $isNumber: "$x" }, { $isNumber: "$y" }] } } },
          {
            $group: {
              _id: { bx: bucketOf("$x", grid.bucketWidth, max), by: bucketOf("$y", grid.bucketHeight, max) },
              count: { $sum: 1 }
            }
          }
        ])
        .toArray();
      return rows.map((row: any) => ({ bx: row._id.bx, by: row._id.by, count: row.count }));
    }
  };
};
