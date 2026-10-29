import type { DbContext } from "./db";
import { eventRowId } from "./event-row-id";
import { insertEventsWithRollup } from "./heatmap-rollup";
import { storedBucket } from "./viewport-bucket";

const sanitizeEventMeta = (meta: any) => {
  if (!meta || typeof meta !== "object") return undefined;
  const clone = { ...meta };
  delete clone.value;
  delete clone.text;
  delete clone.content;
  return clone;
};

const isMongo = (ctx: DbContext) => ctx.dialect === "mongodb";

export const insertEvents = async (ctx: DbContext, projectId: string, userId: string | undefined, payload: any) => {
  const rows: any[] = [];

  for (const event of payload.events) {
    if (event.type === "input" && event.masked && /[^*]/.test(event.masked)) {
      continue;
    }

    const base = {
      id: eventRowId(projectId, event.eventId),
      projectId,
      sessionId: payload.session.id,
      userId: userId ?? null,
      type: event.type,
      ts: event.ts,
      path: event.path,
      selector: event.selector ?? null,
      viewportBucket: storedBucket(event.viewport, sanitizeEventMeta(event.meta)),
      metaJson: JSON.stringify({
        viewport: event.viewport,
        device: event.device,
        meta: sanitizeEventMeta(event.meta)
      })
    };

    if (event.type === "move" && Array.isArray(event.points)) {
      event.points.forEach((point: { x: number; y: number; tsOffset: number }, index: number) => {
        rows.push({
          ...base,
          id: eventRowId(projectId, event.eventId, index),
          ts: event.ts + point.tsOffset,
          x: Math.round(point.x),
          y: Math.round(point.y)
        });
      });
      continue;
    }

    if (event.type === "click") {
      rows.push({
        ...base,
        x: Math.round(event.x),
        y: Math.round(event.y)
      });
      continue;
    }

    if (event.type === "scroll") {
      rows.push({
        ...base,
        scrollDepth: Math.round(event.scrollDepthPct)
      });
      continue;
    }

    rows.push(base);
  }

  if (rows.length === 0) return;

  if (isMongo(ctx)) {
    await insertMongoEvents(ctx, rows);
    return;
  }

  await insertEventsWithRollup(ctx, rows);
};

/** Inserts only rows whose deterministic id is new; duplicate key races are ignored. */
const insertMongoEvents = async (ctx: DbContext, rows: any[]) => {
  const unique = new Map<string, any>();
  for (const row of rows) {
    if (!unique.has(row.id)) unique.set(row.id, row);
  }
  const candidates = [...unique.values()];
  const existing = new Set(
    (
      await ctx.db
        .collection("events")
        .find({ id: { $in: candidates.map((row) => row.id) } }, { projection: { id: 1 } })
        .toArray()
    ).map((row: { id: string }) => row.id)
  );
  const fresh = candidates.filter((row) => !existing.has(row.id));
  if (fresh.length === 0) return;
  try {
    await ctx.db.collection("events").insertMany(fresh, { ordered: false });
  } catch (error: any) {
    // Concurrent retry of the same eventIds: ignore duplicate-key, rethrow anything else.
    if (error?.code !== 11000 && !String(error?.message || "").includes("duplicate")) throw error;
  }
};
