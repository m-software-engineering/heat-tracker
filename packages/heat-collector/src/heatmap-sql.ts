import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DbContext } from "./db";
import { catchUpRollup } from "./heatmap-migrate";
import { ROLLUP_HOUR_MS } from "./heatmap-rollup";
import type { HeatmapBackend, HeatmapFilter, HeatmapGrid } from "./heatmap-types";

type SqlDialect = "pg" | "mysql" | "sqlite";
type Bucket = { bx: number; by: number; count: number };

// All arithmetic runs in IEEE doubles, in the same order as the old JS path, so buckets match exactly.
const DOUBLE: Record<SqlDialect, string> = { pg: "double precision", mysql: "DOUBLE", sqlite: "REAL" };

// Grid numbers are inlined (not bound) so SELECT and GROUP BY see identical expressions. They come
// from validated integers, so String(value) is always a plain numeric literal.
const num = (dialect: SqlDialect, value: number) => sql.raw(`CAST(${String(value)} AS ${DOUBLE[dialect]})`);

const dbl = (dialect: SqlDialect, expr: SQL | unknown) => sql`CAST(${expr} AS ${sql.raw(DOUBLE[dialect])})`;

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

const toNumber = (value: unknown) => (typeof value === "number" ? value : Number(value || 0));
const PLOTTABLE = ["click", "move", "scroll"];

/** A table the grouped queries read: raw `events` (one row per event) or the hourly rollup (`cnt` per row). */
type Source = {
  table: any;
  ts: any;
  x: any;
  y: any;
  depth: any;
  type: any;
  bucket: any;
  count: SQL;
  isScroll: SQL;
  positioned: SQL;
  where: (filter: HeatmapFilter, extra?: SQL) => SQL | undefined;
};

const sourceWhere = (columns: any, ts: any, bucket: any) => (filter: HeatmapFilter, extra?: SQL) => {
  const filters = [eq(columns.projectId, filter.projectId), gte(ts, filter.from), lte(ts, filter.to)];
  if (filter.type !== "all") filters.push(eq(columns.type, filter.type));
  if (filter.path) filters.push(eq(columns.path, filter.path));
  if (filter.viewport) filters.push(eq(bucket, filter.viewport));
  if (extra) filters.push(extra);
  return and(...filters);
};

const rawSource = (events: any): Source => {
  // Scroll rows with a depth plot at x=0 and a y derived from depth; other rows need both x and y.
  const isScroll = sql`(${events.type} = 'scroll' AND ${events.scrollDepth} IS NOT NULL)`;
  return {
    table: events,
    ts: events.ts,
    x: events.x,
    y: events.y,
    depth: events.scrollDepth,
    type: events.type,
    bucket: sql`COALESCE(${events.viewportBucket}, '')`,
    count: sql`count(*)`,
    isScroll,
    positioned: sql`(${isScroll} OR (${events.x} IS NOT NULL AND ${events.y} IS NOT NULL))`,
    where: sourceWhere(events, events.ts, events.viewportBucket)
  };
};

const rollupSource = (rollup: any): Source => ({
  table: rollup,
  ts: rollup.hourTs,
  x: rollup.x,
  y: rollup.y,
  depth: rollup.depth,
  type: rollup.type,
  bucket: rollup.vb,
  count: sql`SUM(${rollup.cnt})`,
  isScroll: sql`(${rollup.pos} = 2)`,
  positioned: sql`(${rollup.pos} > 0)`,
  where: sourceWhere(rollup, rollup.hourTs, rollup.vb)
});

/** Splits [from, to] into whole hours (rollup) and the partial edges (raw events). */
export const splitRange = (filter: HeatmapFilter) => {
  const firstHour = Math.ceil(filter.from / ROLLUP_HOUR_MS) * ROLLUP_HOUR_MS;
  const endHour = Math.floor((filter.to + 1) / ROLLUP_HOUR_MS) * ROLLUP_HOUR_MS; // exclusive
  if (firstHour >= endHour) return { raw: [filter], rollup: undefined };
  const raw: HeatmapFilter[] = [];
  if (filter.from < firstHour) raw.push({ ...filter, to: firstHour - 1 });
  if (endHour <= filter.to) raw.push({ ...filter, from: endHour });
  return { raw, rollup: { ...filter, from: firstHour, to: endHour - ROLLUP_HOUR_MS } };
};

export const aggregateSql = (ctx: DbContext): HeatmapBackend => {
  const dialect = ctx.dialect as SqlDialect;
  const { events, heatmapRollup } = ctx.schema as any;
  const db = ctx.db;
  const raw = rawSource(events);
  const rollup = rollupSource(heatmapRollup);
  // With a non-scroll type filter no row can be a scroll row, so the CASE is dropped (≈15% faster).
  const mayContainScroll = (filter: HeatmapFilter) => filter.type === "all" || filter.type === "scroll";

  // Runs `query` on every part of the range and returns the per-part results.
  // Once per request (one backend per request): count pending rows first, or read raw if some remain.
  let ready: Promise<boolean> | undefined;
  const across = async <T>(filter: HeatmapFilter, query: (source: Source, part: HeatmapFilter) => Promise<T>) => {
    ready ??= catchUpRollup(ctx, filter.projectId);
    const parts = (await ready) ? splitRange(filter) : { raw: [filter], rollup: undefined };
    return Promise.all([
      ...parts.raw.map((part) => query(raw, part)),
      ...(parts.rollup ? [query(rollup, parts.rollup)] : [])
    ]);
  };

  const countBy = (column: "type" | "bucket") => (source: Source, filter: HeatmapFilter) =>
    db
      .select({ key: source[column], count: source.count })
      .from(source.table)
      .where(source.where(filter))
      .groupBy(sql`1`) as Promise<Array<{ key: unknown; count: unknown }>>;

  const sumBy = async (filter: HeatmapFilter, column: "type" | "bucket") => {
    const totals: Record<string, number> = {};
    for (const rows of await across(filter, countBy(column))) {
      for (const row of rows) totals[String(row.key)] = (totals[String(row.key)] || 0) + toNumber(row.count);
    }
    return totals;
  };

  const maxY = async (source: Source, filter: HeatmapFilter) => {
    const notScroll = mayContainScroll(filter) ? sql` AND NOT ${source.isScroll}` : sql``;
    const rows = await db
      .select({ maxY: sql`MAX(${source.y})` })
      .from(source.table)
      .where(source.where(filter, sql`${source.positioned}${notScroll}`));
    const value = rows[0]?.maxY;
    return value == null ? null : toNumber(value);
  };

  const noCoordinates = async (source: Source, filter: HeatmapFilter) => {
    const rows = await db
      .select({ count: source.count })
      .from(source.table)
      .where(source.where(filter, sql`NOT ${source.positioned} AND ${inArray(source.type, PLOTTABLE)}`));
    return toNumber(rows[0]?.count);
  };

  const buckets = async (source: Source, filter: HeatmapFilter, grid: HeatmapGrid): Promise<Bucket[]> => {
    const scrollRows = mayContainScroll(filter);
    const d = dbl(dialect, source.depth);
    const depth = sql`CASE WHEN ${source.depth} > 100 THEN ${d} / 100 ELSE ${d} END`;
    const scrollY = floor(dialect, sql`(${depth}) / 100 * ${num(dialect, grid.renderHeight)} + 0.5`);
    const x = scrollRows ? sql`CASE WHEN ${source.isScroll} THEN 0 ELSE ${source.x} END` : sql`${source.x}`;
    const y = scrollRows ? sql`CASE WHEN ${source.isScroll} THEN ${scrollY} ELSE ${source.y} END` : sql`${source.y}`;
    const max = grid.resolution - 1;
    const bx = clamp(dialect, floor(dialect, sql`${dbl(dialect, x)} / ${num(dialect, grid.bucketWidth)}`), max);
    const by = clamp(dialect, floor(dialect, sql`${dbl(dialect, y)} / ${num(dialect, grid.bucketHeight)}`), max);
    // One integer key (by * resolution + bx) hashes faster than two double keys.
    const key = sql`${toInt(dialect, by)} * ${sql.raw(String(grid.resolution))} + ${toInt(dialect, bx)}`;
    const rows = await db
      .select({ key, count: source.count })
      .from(source.table)
      .where(source.where(filter, source.positioned))
      .groupBy(sql`1`);
    return rows.map((row: any) => {
      const k = toNumber(row.key);
      return { bx: k % grid.resolution, by: Math.floor(k / grid.resolution), count: toNumber(row.count) };
    });
  };

  return {
    typeCounts: (filter) => sumBy(filter, "type"),

    bucketCounts: (filter) => sumBy(filter, "bucket"),

    maxY: async (filter) => {
      const values = (await across(filter, maxY)).filter((v): v is number => v != null);
      return values.length === 0 ? null : Math.max(...values);
    },

    noCoordinates: async (filter) => (await across(filter, noCoordinates)).reduce((sum, n) => sum + n, 0),

    // The viewport sample is "most recent events", so it always reads raw events.
    recentBuckets: async (filter, limit) => {
      const recent = db
        .select({ bucket: sql<string>`${raw.bucket}`.as("bucket") })
        .from(events)
        .where(raw.where(filter))
        .orderBy(desc(events.ts))
        .limit(limit)
        .as("recent");
      const rows = await db
        .select({ bucket: recent.bucket, count: sql`count(*)` })
        .from(recent)
        .groupBy(sql`1`);
      return Object.fromEntries(rows.map((row: any) => [String(row.bucket), toNumber(row.count)]));
    },

    buckets: async (filter, grid) => {
      const merged = new Map<number, Bucket>();
      for (const part of await across(filter, (source, f) => buckets(source, f, grid))) {
        for (const b of part) {
          const k = b.by * grid.resolution + b.bx;
          const existing = merged.get(k);
          if (existing) existing.count += b.count;
          else merged.set(k, { ...b });
        }
      }
      return [...merged.values()];
    }
  };
};
