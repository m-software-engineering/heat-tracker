import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { DbContext } from "./db";
import type { HeatmapBackend, HeatmapFilter, HeatmapGrid } from "./heatmap-types";

type SqlDialect = "pg" | "mysql" | "sqlite";

// All arithmetic runs in IEEE doubles, in the same order as the old JS path, so buckets match exactly.
const DOUBLE: Record<SqlDialect, string> = { pg: "double precision", mysql: "DOUBLE", sqlite: "REAL" };

// Grid numbers are inlined (not bound) so SELECT and GROUP BY see identical expressions. They come
// from validated integers, so String(value) is always a plain numeric literal.
const num = (dialect: SqlDialect, value: number) => sql.raw(`CAST(${String(value)} AS ${DOUBLE[dialect]})`);

const dbl = (dialect: SqlDialect, expr: SQL) => sql`CAST(${expr} AS ${sql.raw(DOUBLE[dialect])})`;

// SQLite has no floor() without the math extension; CAST truncates, which equals floor for every
// value that survives the clamp to [0, resolution - 1] (negatives clamp to 0 either way).
const floor = (dialect: SqlDialect, expr: SQL) =>
  dialect === "sqlite" ? sql`CAST(${expr} AS INTEGER)` : sql`FLOOR(${expr})`;

// Values are already whole numbers (FLOOR then clamp), so the cast is exact in every dialect.
const toInt = (dialect: SqlDialect, expr: SQL) =>
  sql`CAST(${expr} AS ${sql.raw(dialect === "mysql" ? "SIGNED" : "INTEGER")})`;

const clamp = (dialect: SqlDialect, expr: SQL, max: number) =>
  dialect === "sqlite"
    ? sql`MIN(${sql.raw(String(max))}, MAX(0, ${expr}))`
    : sql`LEAST(${sql.raw(String(max))}, GREATEST(0, ${expr}))`;

const jsonText = (dialect: SqlDialect, column: unknown, path: string[]) => {
  if (dialect === "pg") return sql`(CAST(${column} AS jsonb) #>> ${sql.raw(`'{${path.join(",")}}'`)})`;
  const jsonPath = sql.raw(`'$.${path.join(".")}'`);
  if (dialect === "mysql") return sql`JSON_UNQUOTE(JSON_EXTRACT(${column}, ${jsonPath}))`;
  return sql`json_extract(${column}, ${jsonPath})`;
};

const toNumber = (value: unknown) => (typeof value === "number" ? value : Number(value || 0));

export const aggregateSql = (ctx: DbContext): HeatmapBackend => {
  const dialect = ctx.dialect as SqlDialect;
  const { events } = ctx.schema as any;
  const db = ctx.db;

  const where = (filter: HeatmapFilter, extra?: SQL) => {
    const filters = [eq(events.projectId, filter.projectId), gte(events.ts, filter.from), lte(events.ts, filter.to)];
    if (filter.type !== "all") filters.push(eq(events.type, filter.type));
    if (filter.path) filters.push(eq(events.path, filter.path));
    if (extra) filters.push(extra);
    return and(...filters);
  };

  // Scroll rows with a depth plot at x=0 and a y derived from depth; every other row uses x/y
  // (NULL counts as 0, exactly as Number(null) did in the old Node path).
  const isScroll = sql`(${events.type} = 'scroll' AND ${events.scrollDepth} IS NOT NULL)`;
  // With a non-scroll type filter no row can be a scroll row, so the CASE is dropped (≈15% faster).
  const mayContainScroll = (filter: HeatmapFilter) => filter.type === "all" || filter.type === "scroll";

  return {
    typeCounts: async (filter) => {
      const rows = await db
        .select({ type: events.type, count: sql`count(*)` })
        .from(events)
        .where(where(filter))
        .groupBy(events.type);
      return Object.fromEntries(rows.map((row: any) => [String(row.type), toNumber(row.count)]));
    },

    maxY: async (filter) => {
      const y = sql`COALESCE(${events.y}, 0)`;
      const rows = await db
        .select({
          maxY: mayContainScroll(filter) ? sql`MAX(CASE WHEN ${isScroll} THEN NULL ELSE ${y} END)` : sql`MAX(${y})`
        })
        .from(events)
        .where(where(filter));
      const value = rows[0]?.maxY;
      return value == null ? null : toNumber(value);
    },

    viewportGroups: async (filter, limit, visit) => {
      const recent = db
        .select({ metaJson: events.metaJson })
        .from(events)
        .where(where(filter))
        .orderBy(desc(events.ts))
        .limit(limit)
        .as("recent");
      const explicit = jsonText(dialect, recent.metaJson, ["meta", "viewportBucket"]);
      const w = jsonText(dialect, recent.metaJson, ["viewport", "w"]);
      const h = jsonText(dialect, recent.metaJson, ["viewport", "h"]);
      const rows = await db
        .select({ explicit, w, h, count: sql`count(*)` })
        .from(recent)
        .groupBy(sql`1`, sql`2`, sql`3`);
      for (const row of rows) visit({ explicit: row.explicit, w: row.w, h: row.h, count: toNumber(row.count) });
    },

    buckets: async (filter, grid: HeatmapGrid) => {
      const scrollRows = mayContainScroll(filter);
      const depth = sql`CASE WHEN ${events.scrollDepth} > 100 THEN ${dbl(dialect, events.scrollDepth)} / 100 ELSE ${dbl(dialect, events.scrollDepth)} END`;
      const scrollY = floor(dialect, sql`(${depth}) / 100 * ${num(dialect, grid.renderHeight)} + 0.5`);
      const x = scrollRows
        ? sql`CASE WHEN ${isScroll} THEN 0 ELSE COALESCE(${events.x}, 0) END`
        : sql`COALESCE(${events.x}, 0)`;
      const y = scrollRows
        ? sql`CASE WHEN ${isScroll} THEN ${scrollY} ELSE COALESCE(${events.y}, 0) END`
        : sql`COALESCE(${events.y}, 0)`;
      const max = grid.resolution - 1;
      const bx = clamp(dialect, floor(dialect, sql`${dbl(dialect, x)} / ${num(dialect, grid.bucketWidth)}`), max);
      const by = clamp(dialect, floor(dialect, sql`${dbl(dialect, y)} / ${num(dialect, grid.bucketHeight)}`), max);
      // One integer key (by * resolution + bx) hashes faster than two double keys.
      const key = sql`${toInt(dialect, by)} * ${sql.raw(String(grid.resolution))} + ${toInt(dialect, bx)}`;
      const rows = await db
        .select({ key, count: sql`count(*)` })
        .from(events)
        .where(where(filter))
        .groupBy(sql`1`);
      return rows.map((row: any) => {
        const k = toNumber(row.key);
        return { bx: k % grid.resolution, by: Math.floor(k / grid.resolution), count: toNumber(row.count) };
      });
    }
  };
};
