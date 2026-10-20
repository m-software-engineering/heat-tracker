import type { DbContext } from "./db";
import { aggregateMongo } from "./heatmap-mongo";
import { aggregateSql } from "./heatmap-sql";
import type { EventQueryType, EventType, HeatmapBackend, HeatmapFilter, ViewportGroup } from "./heatmap-types";

/**
 * The default viewport is the most common bucket among this many most recent events. Viewports live in
 * meta JSON, and parsing it for every event alone costs seconds at 1 M events (#26 bench).
 */
export const VIEWPORT_SAMPLE_SIZE = 10_000;

export const HEATMAP_PLOTTABLE_TYPES: EventType[] = ["click", "move", "scroll"];
const DEFAULT_VIEWPORT = { w: 1280, h: 720 };
const NOT_PLOTTABLE_WARNING =
  "Events matched the filter but none are plottable. Use type=click|move|scroll or inspect /api/projects/:projectId/events.";

export const parseViewportBucket = (bucket?: string) => {
  if (!bucket) return null;
  const [w, h] = bucket.split("x").map((n) => Number(n));
  if (!w || !h) return null;
  return { w, h };
};

const toViewportBucket = (w: number, h: number) => `${Math.round(w / 100) * 100}x${Math.round(h / 100) * 100}`;

/** Same precedence as ingest-time meta: explicit `meta.viewportBucket`, then the rounded viewport. */
export const pickBucket = (group: Omit<ViewportGroup, "count">) => {
  if (typeof group.explicit === "string" && parseViewportBucket(group.explicit)) return group.explicit;
  const w = Number(group.w);
  const h = Number(group.h);
  if (group.w != null && group.h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return toViewportBucket(w, h);
  }
  return undefined;
};

const backendFor = (ctx: DbContext): HeatmapBackend =>
  ctx.dialect === "mongodb" ? aggregateMongo(ctx) : aggregateSql(ctx);

const dominantBucket = async (backend: HeatmapBackend, filter: HeatmapFilter) => {
  const counts = new Map<string, number>();
  await backend.viewportGroups(filter, VIEWPORT_SAMPLE_SIZE, (group) => {
    const bucket = pickBucket(group);
    if (bucket) counts.set(bucket, (counts.get(bucket) || 0) + group.count);
  });
  // Highest count wins; ties break by bucket name so the result does not depend on row order.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
};

/**
 * Aggregates a heatmap in the database with three grouped queries (summary and viewport in parallel,
 * then buckets); none returns raw events, so collector memory does not grow with matched events.
 * Output matches the pre-#26 in-Node path whenever at most VIEWPORT_SAMPLE_SIZE events match.
 */
export const aggregateHeatmap = async (
  ctx: DbContext,
  filter: HeatmapFilter,
  options: { resolution: number; viewportBucket?: string; requestedType: EventQueryType }
) => {
  const backend = backendFor(ctx);
  const { resolution } = options;
  const [{ typeBreakdown, maxY: observedY }, dominant] = await Promise.all([
    backend.summary(filter),
    options.viewportBucket ? undefined : dominantBucket(backend, filter)
  ]);
  const total = Object.values(typeBreakdown).reduce((sum, n) => sum + n, 0);

  const preferredBucket = options.viewportBucket || dominant;
  const viewport = parseViewportBucket(preferredBucket) || DEFAULT_VIEWPORT;
  const renderHeight = Math.max(viewport.h, observedY == null ? viewport.h : Math.round(observedY));
  const grid = {
    resolution,
    bucketWidth: viewport.w / resolution,
    bucketHeight: renderHeight / resolution,
    renderHeight
  };

  const buckets = total > 0 ? await backend.buckets(filter, grid) : [];
  const points = buckets
    .map(({ bx, by, count }) => ({
      x: Math.round((bx + 0.5) * grid.bucketWidth),
      y: Math.round((by + 0.5) * grid.bucketHeight),
      value: count
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const plotted = buckets.reduce((sum, b) => sum + b.count, 0);

  return {
    points,
    meta: {
      resolution,
      viewport,
      renderHeight,
      total,
      totalEvents: total,
      // Every matched event is aggregated; `true` is reserved for a future sampled/rollup path.
      sampled: false,
      plotted,
      ignored: Math.max(0, total - plotted),
      requestedType: options.requestedType,
      resolvedType: filter.type,
      bucket: preferredBucket || `${viewport.w}x${viewport.h}`,
      plottableTypes: HEATMAP_PLOTTABLE_TYPES,
      typeBreakdown,
      ...(total > 0 && plotted === 0 ? { warning: NOT_PLOTTABLE_WARNING } : {})
    }
  };
};
