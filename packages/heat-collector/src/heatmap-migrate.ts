import { inArray, isNull, sql } from "drizzle-orm";
import { buildBackfillRollupSql, buildCreateRollupSql, ROLLUP_TABLE } from "./heatmap-rollup";
import { safeParseMetaJson } from "./meta-json";
import { storedBucket } from "./viewport-bucket";

const BATCH = 5000;

const bucketOf = (metaJson: unknown) => {
  const meta = safeParseMetaJson(metaJson);
  return storedBucket(meta.viewport, meta.meta);
};

/** Groups ids by bucket so each batch needs one UPDATE per distinct bucket. */
const byBucket = (rows: Array<{ id: string; metaJson: unknown }>) => {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = bucketOf(row.metaJson);
    groups.set(bucket, [...(groups.get(bucket) ?? []), row.id]);
  }
  return groups;
};

/**
 * #26 migration, idempotent: fills `viewport_bucket` on events stored before the column existed
 * (in Node, so the bucket rule is the ingest rule), then builds the rollup when it is empty.
 */
export const migrateHeatmapSql = async (ctx: any, execute: (db: any, statement: any) => Promise<unknown>) => {
  const { events } = ctx.schema;
  for (;;) {
    const rows = await ctx.db
      .select({ id: events.id, metaJson: events.metaJson })
      .from(events)
      .where(isNull(events.viewportBucket))
      .limit(BATCH);
    if (rows.length === 0) break;
    for (const [bucket, ids] of byBucket(rows)) {
      await ctx.db.update(events).set({ viewportBucket: bucket }).where(inArray(events.id, ids));
    }
  }
  await execute(ctx.db, buildCreateRollupSql(ctx.dialect));
  const counted = await ctx.db.select({ n: sql`count(*)` }).from(sql.raw(ROLLUP_TABLE));
  if (Number(counted[0]?.n ?? 0) === 0) await execute(ctx.db, buildBackfillRollupSql());
};

/** Mongo has no rollup (#26 open question); it only gets `viewportBucket` on older documents. */
export const migrateHeatmapMongo = async (db: any) => {
  const events = db.collection("events");
  for (;;) {
    const rows = await events
      .find({ viewportBucket: { $exists: false } }, { projection: { _id: 0, id: 1, metaJson: 1 } })
      .limit(BATCH)
      .toArray();
    if (rows.length === 0) break;
    for (const [bucket, ids] of byBucket(rows)) {
      await events.updateMany({ id: { $in: ids } }, { $set: { viewportBucket: bucket } });
    }
  }
};
