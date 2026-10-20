import { sql } from "drizzle-orm";
import * as mysqlCore from "drizzle-orm/mysql-core";
import * as pgCore from "drizzle-orm/pg-core";
import * as sqliteCore from "drizzle-orm/sqlite-core";

/**
 * Heatmap rollup (#26): events pre-aggregated per (project, path, type, viewport bucket, hour, position).
 * Positions stay at pixel precision, so a query over whole hours reads the rollup and still buckets
 * exactly like the raw rows. `pos` is 0 = no coordinates, 1 = x/y, 2 = scroll depth.
 * Maintained at ingest (`upsertRollup`) and backfilled by `autoMigrate` when the table is empty.
 */
export const ROLLUP_TABLE = "heatmap_rollup";
export const ROLLUP_HOUR_MS = 3_600_000;

type SqlDialect = "pg" | "mysql" | "sqlite";

export const createRollupTable = (dialect: SqlDialect) => {
  if (dialect === "pg") {
    const { pgTable, text, bigint, integer } = pgCore;
    return pgTable(ROLLUP_TABLE, {
      projectId: text("project_id").notNull(),
      path: text("path").notNull(),
      type: text("type").notNull(),
      vb: text("vb").notNull(),
      hourTs: bigint("hour_ts", { mode: "number" }).notNull(),
      pos: integer("pos").notNull(),
      x: integer("x").notNull(),
      y: integer("y").notNull(),
      depth: integer("depth").notNull(),
      cnt: bigint("cnt", { mode: "number" }).notNull()
    });
  }
  if (dialect === "mysql") {
    const { mysqlTable, varchar, bigint, int } = mysqlCore;
    return mysqlTable(ROLLUP_TABLE, {
      projectId: varchar("project_id", { length: 64 }).notNull(),
      path: varchar("path", { length: 1024 }).notNull(),
      type: varchar("type", { length: 64 }).notNull(),
      vb: varchar("vb", { length: 32 }).notNull(),
      hourTs: bigint("hour_ts", { mode: "number" }).notNull(),
      pos: int("pos").notNull(),
      x: int("x").notNull(),
      y: int("y").notNull(),
      depth: int("depth").notNull(),
      cnt: bigint("cnt", { mode: "number" }).notNull()
    });
  }
  const { sqliteTable, text, integer } = sqliteCore;
  return sqliteTable(ROLLUP_TABLE, {
    projectId: text("project_id").notNull(),
    path: text("path").notNull(),
    type: text("type").notNull(),
    vb: text("vb").notNull(),
    hourTs: integer("hour_ts").notNull(),
    pos: integer("pos").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    depth: integer("depth").notNull(),
    cnt: integer("cnt").notNull()
  });
};

const KEY_COLUMNS = "project_id, path, type, vb, hour_ts, pos, x, y, depth";

/** CREATE TABLE for the rollup. MySQL keys on a stored SHA-256 of `path` (VARCHAR(1024) is too long for a key). */
export const buildCreateRollupSql = (dialect: SqlDialect) => {
  if (dialect === "mysql") {
    return sql.raw(`CREATE TABLE IF NOT EXISTS ${ROLLUP_TABLE} (
      project_id VARCHAR(64) NOT NULL, path VARCHAR(1024) NOT NULL, type VARCHAR(64) NOT NULL, vb VARCHAR(32) NOT NULL,
      hour_ts BIGINT NOT NULL, pos INT NOT NULL, x INT NOT NULL, y INT NOT NULL, depth INT NOT NULL, cnt BIGINT NOT NULL,
      path_hash BINARY(32) AS (UNHEX(SHA2(path, 256))) STORED,
      UNIQUE KEY ${ROLLUP_TABLE}_key (project_id, path_hash, type, vb, hour_ts, pos, x, y, depth)
    );`);
  }
  const big = dialect === "pg" ? "BIGINT" : "INTEGER";
  return sql.raw(`CREATE TABLE IF NOT EXISTS ${ROLLUP_TABLE} (
    project_id TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL, vb TEXT NOT NULL, hour_ts ${big} NOT NULL,
    pos INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, depth INTEGER NOT NULL, cnt ${big} NOT NULL,
    PRIMARY KEY (${KEY_COLUMNS})
  );`);
};

// One position per event, the same rule the raw backend applies (see heatmap-sql.ts).
const POS = `CASE WHEN type = 'scroll' AND scroll_depth IS NOT NULL THEN 2 WHEN x IS NOT NULL AND y IS NOT NULL THEN 1 ELSE 0 END`;

/** Backfill from `events` (the migration for existing installs). Run only while the rollup is empty. */
export const buildBackfillRollupSql = () =>
  sql.raw(`INSERT INTO ${ROLLUP_TABLE} (${KEY_COLUMNS}, cnt)
    SELECT project_id, path, type, COALESCE(viewport_bucket, ''), ts - (ts % ${ROLLUP_HOUR_MS}), ${POS},
      CASE WHEN ${POS} = 1 THEN x ELSE 0 END, CASE WHEN ${POS} = 1 THEN y ELSE 0 END,
      CASE WHEN ${POS} = 2 THEN scroll_depth ELSE 0 END, count(*)
    FROM events GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`);

type RollupEvent = {
  projectId: string;
  path: string;
  type: string;
  ts: number;
  viewportBucket?: string | null;
  x?: number | null;
  y?: number | null;
  scrollDepth?: number | null;
};

/** Groups inserted event rows into rollup increments. */
export const toRollupRows = (rows: RollupEvent[]) => {
  const grouped = new Map<
    string,
    {
      projectId: string;
      path: string;
      type: string;
      vb: string;
      hourTs: number;
      pos: number;
      x: number;
      y: number;
      depth: number;
      cnt: number;
    }
  >();
  for (const row of rows) {
    const pos = row.type === "scroll" && row.scrollDepth != null ? 2 : row.x != null && row.y != null ? 1 : 0;
    const entry = {
      projectId: row.projectId,
      path: row.path,
      type: row.type,
      vb: row.viewportBucket ?? "",
      hourTs: row.ts - (row.ts % ROLLUP_HOUR_MS),
      pos,
      x: pos === 1 ? Number(row.x) : 0,
      y: pos === 1 ? Number(row.y) : 0,
      depth: pos === 2 ? Number(row.scrollDepth) : 0,
      cnt: 1
    };
    const key = JSON.stringify([
      entry.projectId,
      entry.path,
      entry.type,
      entry.vb,
      entry.hourTs,
      pos,
      entry.x,
      entry.y,
      entry.depth
    ]);
    const existing = grouped.get(key);
    if (existing) existing.cnt += 1;
    else grouped.set(key, entry);
  }
  return [...grouped.values()];
};

/** Adds the rows' counts to the rollup (insert or increment). */
export const upsertRollup = async (db: any, dialect: SqlDialect, table: any, rows: RollupEvent[]) => {
  const values = toRollupRows(rows);
  if (values.length === 0) return;
  if (dialect === "mysql") {
    await db
      .insert(table)
      .values(values)
      .onDuplicateKeyUpdate({ set: { cnt: sql`cnt + VALUES(cnt)` } });
    return;
  }
  await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({
      target: [
        table.projectId,
        table.path,
        table.type,
        table.vb,
        table.hourTs,
        table.pos,
        table.x,
        table.y,
        table.depth
      ],
      set: { cnt: sql`${sql.raw(ROLLUP_TABLE)}.cnt + excluded.cnt` }
    });
};
