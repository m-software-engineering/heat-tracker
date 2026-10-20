import { and, inArray, isNull } from "drizzle-orm";
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
export const backfillRollup = async (ctx: any) => {
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
  const batch = (tx: any, rows: any[], run: (q: any) => unknown) => {
    for (const row of rows) row.viewportBucket ??= bucketOf(row.metaJson);
    const results: unknown[] = [upsertRollup(tx, ctx.dialect, heatmapRollup, rows, run)];
    for (const [bucket, ids] of groupIds(rows, (row: any) => row.viewportBucket)) {
      const update = tx.update(events).set({ viewportBucket: bucket, rollupState: 1 });
      results.push(run(update.where(and(inArray(events.id, ids), pending))));
    }
    return results;
  };

  let counted = 0;
  for (;;) {
    const size =
      ctx.dialect === "sqlite"
        ? await inTransaction(ctx, (tx, run) => {
            const rows = tx.select(columns).from(events).where(pending).limit(BATCH).all();
            batch(tx, rows, run);
            return rows.length;
          })
        : await inTransaction(ctx, async (tx, run) => {
            const rows = await tx
              .select(columns)
              .from(events)
              .where(pending)
              .limit(BATCH)
              .for("update", { skipLocked: true });
            await Promise.all(batch(tx, rows, run));
            return rows.length;
          });
    if (size === 0) return counted;
    counted += size;
  }
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
