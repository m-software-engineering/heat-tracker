/** Viewport buckets ("1440x900"): stored per event at ingest and used to pick and filter heatmap grids. */
export const MAX_BUCKET_LENGTH = 32;

export const parseViewportBucket = (bucket?: string) => {
  if (!bucket) return null;
  const [w, h] = bucket.split("x").map((n) => Number(n));
  if (!w || !h) return null;
  return { w, h };
};

const toViewportBucket = (w: number, h: number) => `${Math.round(w / 100) * 100}x${Math.round(h / 100) * 100}`;

/** Explicit `meta.viewportBucket` first, then the rounded viewport. */
export const pickBucket = (group: { explicit: unknown; w: unknown; h: unknown }) => {
  if (typeof group.explicit === "string" && parseViewportBucket(group.explicit)) return group.explicit;
  const w = Number(group.w);
  const h = Number(group.h);
  if (group.w != null && group.h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return toViewportBucket(w, h);
  }
  return undefined;
};

/** Bucket stored in `events.viewport_bucket`: "" when the event has none (or an oversized one). */
export const storedBucket = (viewport: any, meta: any) => {
  const bucket = pickBucket({ explicit: meta?.viewportBucket, w: viewport?.w, h: viewport?.h });
  return bucket && bucket.length <= MAX_BUCKET_LENGTH ? bucket : "";
};
