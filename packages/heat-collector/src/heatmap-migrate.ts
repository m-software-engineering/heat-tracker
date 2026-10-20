import { and, eq, inArray, isNull } from "drizzle-orm";
import { buildCreateRollupSql, inTransaction, upsertRollup } from "./heatmap-rollup";
import { safeParseMetaJson } from "./meta-json";
import { storedBucket } from "./viewport-bucket";

// 5000 rows × 10 rollup columns stays under Postgres' 65,535 bind parameters.
const BATCH = 5000;

const bucketOf = (metaJson: unknown) => {
  const meta = safeParseMetaJson(metaJson);
  return storedBucket(meta.viewport, meta.meta);
};

/** Groups ids by a value so each batch needs one UPDATE per distinct value. */
const groupIds = <T>(rows: Array<{ id: string } & T>, valueOf: (row: T) => string) => {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const value = valueOf(row);
    groups.set(value, [...(groups.get(value) ?? []), row.id]);
  }
  return groups;
};

/**
 * #26 migration for rows written before the rollup existed (`rollup_state` NULL). Ingest marks its
 * rows 1 in the same transaction that counts them, so it never overlaps this. Each batch locks its
 * rows (`FOR UPDATE SKIP LOCKED`; SQLite: an IMMEDIATE transaction), fills `viewport_bucket`,
 * increments the rollup and marks the rows, all in one transaction: a row is counted exactly once
 * even with concurrent ingest or several collectors migrating, and a crash leaves no partial batch.
 * Re-running is a no-op. Returns the number of rows counted.
 */
export const backfillRollup = async (ctx: any, { maxBatches = Infinity }: { maxBatches?: number } = {}) => {
  const { events, heatmapRollup } = ctx.schema;
  const pending = isNull(events.rollupState);
  const columns = {
    id: events.id,
    projectId: events.projectId,
    path: events.path,
    type: events.type,
    ts: events.ts,
    x: events.x,
    y: events.y,
    scrollDepth: events.scrollDepth,
    metaJson: events.metaJson,
    viewportBucket: events.viewportBucket
  };
  // Statements of one batch, in order; executed one at a time (a pg client runs one query at a time).
  const batch = (tx: any, rows: any[]) => {
    for (const row of rows) row.viewportBucket ??= bucketOf(row.metaJson);
    const statements: unknown[] = [];
    upsertRollup(tx, ctx.dialect, heatmapRollup, rows, (q) => statements.push(q));
    for (const [bucket, ids] of groupIds(rows, (row: any) => row.viewportBucket)) {
      const update = tx.update(events).set({ viewportBucket: bucket, rollupState: 1 });
      statements.push(update.where(and(inArray(events.id, ids), pending)));
    }
    return statements;
  };

  let counted = 0;
  for (let batches = 0; batches < maxBatches; batches += 1) {
    const size =
      ctx.dialect === "sqlite"
        ? await inTransaction(ctx, (tx, run) => {
            const rows = tx.select(columns).from(events).where(pending).limit(BATCH).all();
            for (const statement of batch(tx, rows)) run(statement);
            return rows.length;
          })
        : await inTransaction(ctx, async (tx) => {
            const rows = await tx
              .select(columns)
              .from(events)
              .where(pending)
              .limit(BATCH)
              .for("update", { skipLocked: true });
            for (const statement of batch(tx, rows)) await statement;
            return rows.length;
          });
    if (size === 0) return counted;
    counted += size;
  }
  return counted;
};

/** Whether rows not yet in the rollup exist (for one project, or anywhere). Uses `events_rollup_pending_idx`. */
export const hasPendingRollup = async (ctx: any, projectId?: string) => {
  const { events } = ctx.schema;
  const where = projectId
    ? and(isNull(events.rollupState), eq(events.projectId, projectId))
    : isNull(events.rollupState);
  const rows = await ctx.db.select({ id: events.id }).from(events).where(where).limit(1);
  return rows.length > 0;
};

/** Batches a request may backfill before reading the rollup (≈ 10k rows). */
export const CATCH_UP_BATCHES = 2;

/**
 * Rows written with `rollup_state` NULL after the migration (an older collector during a rolling
 * upgrade, or a direct SQL import) are not in the rollup yet. Before a rollup read: count up to
 * CATCH_UP_BATCHES of them, then report whether the project is fully counted; if not, the caller
 * reads raw events for that request, so results are never missing rows.
 */
export const catchUpRollup = async (ctx: any, projectId: string) => {
  if (!(await hasPendingRollup(ctx))) return true;
  await backfillRollup(ctx, { maxBatches: CATCH_UP_BATCHES });
  return !(await hasPendingRollup(ctx, projectId));
};

/** Creates the rollup table, then counts every row not yet in it (see `backfillRollup`). */
export const migrateHeatmapSql = async (ctx: any, execute: (db: any, statement: any) => Promise<unknown>) => {
  await execute(ctx.db, buildCreateRollupSql(ctx.dialect));
  await backfillRollup(ctx);
};

/** Mongo has no rollup (follow-up issue); it only gets `viewportBucket` on older documents. */
export const migrateHeatmapMongo = async (db: any) => {
  const events = db.collection("events");
  for (;;) {
    const rows = await events
      .find({ viewportBucket: { $exists: false } }, { projection: { _id: 0, id: 1, metaJson: 1 } })
      .limit(BATCH)
      .toArray();
    if (rows.length === 0) break;
    for (const [bucket, ids] of groupIds(rows, (row: any) => bucketOf(row.metaJson))) {
      await events.updateMany({ id: { $in: ids } }, { $set: { viewportBucket: bucket } });
    }
  }
};
