import type { DbContext } from "./db";
import { aggregateMongo } from "./heatmap-mongo";
import { aggregateSql } from "./heatmap-sql";
import type { EventQueryType, EventType, HeatmapBackend, HeatmapFilter } from "./heatmap-types";
import { parseViewportBucket } from "./viewport-bucket";

/** The default viewport is the most common stored bucket among this many most recent events. */
export const VIEWPORT_SAMPLE_SIZE = 10_000;

/** Time range the heatmap covers; `defaulted` when the request gave neither `from` nor `to`. */
export type HeatmapRange = { from: number; to: number; defaulted: boolean };

export const HEATMAP_PLOTTABLE_TYPES: EventType[] = ["click", "move", "scroll"];
const DEFAULT_VIEWPORT = { w: 1280, h: 720 };
const NOT_PLOTTABLE_WARNING =
  "Events matched the filter but none are plottable. Use type=click|move|scroll or inspect /api/projects/:projectId/events.";

const backendFor = (ctx: DbContext): HeatmapBackend =>
  ctx.dialect === "mongodb" ? aggregateMongo(ctx) : aggregateSql(ctx);

const dominantBucket = async (backend: HeatmapBackend, filter: HeatmapFilter) => {
  const counts = Object.entries(await backend.recentBuckets(filter, VIEWPORT_SAMPLE_SIZE)).filter(([bucket]) =>
    parseViewportBucket(bucket)
  );
  // Highest count wins; ties break by bucket name so the result does not depend on row order.
  return counts.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
};

/**
 * Aggregates a heatmap in the database with four grouped queries in two concurrent phases (max y and
 * viewport sample, then type counts and buckets); none returns raw events, so collector memory does not grow with matched events.
 * Output matches the pre-#26 in-Node path whenever at most VIEWPORT_SAMPLE_SIZE events match.
 */
export const aggregateHeatmap = async (
  ctx: DbContext,
  filter: HeatmapFilter,
  options: { resolution: number; viewportBucket?: string; requestedType: EventQueryType; range: HeatmapRange }
) => {
  const backend = backendFor(ctx);
  // Bucket counts ignore the viewport filter so the dashboard can offer every bucket.
  const bucketCountsPromise = backend.bucketCounts({ ...filter, viewport: undefined });
  const { resolution } = options;
  // Phase 1 fixes the grid (max y, viewport); phase 2 counts types and buckets concurrently.
  const [observedY, dominant] = await Promise.all([
    backend.maxY(filter),
    options.viewportBucket || filter.viewport ? undefined : dominantBucket(backend, filter)
  ]);

  const preferredBucket = options.viewportBucket || filter.viewport?.[0] || dominant;
  const viewport = parseViewportBucket(preferredBucket) || DEFAULT_VIEWPORT;
  const renderHeight = Math.max(viewport.h, observedY == null ? viewport.h : Math.round(observedY));
  const grid = {
    resolution,
    bucketWidth: viewport.w / resolution,
    bucketHeight: renderHeight / resolution,
    renderHeight
  };

  const [typeBreakdown, buckets, noCoordinates, bucketCounts] = await Promise.all([
    backend.typeCounts(filter),
    backend.buckets(filter, grid),
    backend.noCoordinates(filter),
    bucketCountsPromise
  ]);
  const total = Object.values(typeBreakdown).reduce((sum, n) => sum + n, 0);
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
      excluded: { noCoordinates },
      range: options.range,
      viewportFilter: filter.viewport?.join(",") ?? null,
      viewportBuckets: Object.entries(bucketCounts)
        .filter(([bucket]) => bucket !== "")
        .map(([bucket, count]) => ({ bucket, count }))
        .sort((a, b) => b.count - a.count || (a.bucket < b.bucket ? -1 : 1)),
      requestedType: options.requestedType,
      resolvedType: filter.type,
      bucket: preferredBucket || `${viewport.w}x${viewport.h}`,
      plottableTypes: HEATMAP_PLOTTABLE_TYPES,
      typeBreakdown,
      ...(total > 0 && plotted === 0 ? { warning: NOT_PLOTTABLE_WARNING } : {})
    }
  };
};
