import type { DbContext } from "./db";
import type { HeatmapBackend, HeatmapFilter, HeatmapGrid } from "./heatmap-types";

const match = (filter: HeatmapFilter) => {
  const query: Record<string, unknown> = { projectId: filter.projectId, ts: { $gte: filter.from, $lte: filter.to } };
  if (filter.type !== "all") query.type = filter.type;
  if (filter.path) query.path = filter.path;
  if (filter.viewport) query.viewportBucket = filter.viewport;
  return query;
};

// Documents omit absent coordinates; rows without a position are skipped, as in the SQL backend.
const isScroll = { $and: [{ $eq: ["$type", "scroll"] }, { $gt: ["$scrollDepth", null] }] };
const positioned = { $or: [isScroll, { $and: [{ $isNumber: "$x" }, { $isNumber: "$y" }] }] };

const countBy = async (events: any, query: Record<string, unknown>, field: string) => {
  const rows = await events.aggregate([{ $match: query }, { $group: { _id: field, count: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((row: any) => [String(row._id ?? ""), row.count]));
};

const bucketOf = (value: unknown, size: number, max: number) => ({
  $min: [max, { $max: [0, { $floor: { $divide: [value, size] } }] }]
});

export const aggregateMongo = (ctx: DbContext): HeatmapBackend => {
  const events = ctx.db.collection("events");

  return {
    typeCounts: (filter) => countBy(events, match(filter), "$type"),

    bucketCounts: (filter) => countBy(events, match(filter), "$viewportBucket"),

    noCoordinates: async (filter) => {
      const query: Record<string, unknown> = { ...match(filter), $expr: { $not: [positioned] } };
      if (filter.type === "all") query.type = { $in: ["click", "move", "scroll"] };
      else if (!["click", "move", "scroll"].includes(filter.type)) return 0;
      return events.countDocuments(query);
    },

    maxY: async (filter) => {
      const rows = await events
        .aggregate([
          { $match: { ...match(filter), $expr: { $and: [positioned, { $not: [isScroll] }] } } },
          { $group: { _id: null, maxY: { $max: "$y" } } }
        ])
        .toArray();
      return typeof rows[0]?.maxY === "number" ? rows[0].maxY : null;
    },

    recentBuckets: async (filter, limit) => {
      const rows = await events
        .aggregate([
          { $match: match(filter) },
          { $sort: { ts: -1 } },
          { $limit: limit },
          { $group: { _id: "$viewportBucket", count: { $sum: 1 } } }
        ])
        .toArray();
      return Object.fromEntries(rows.map((row: any) => [String(row._id ?? ""), row.count]));
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
