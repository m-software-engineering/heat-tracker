/** Types shared by the heatmap aggregator and its dialect backends. */
export type EventType = "click" | "move" | "scroll" | "pageview" | "custom" | "input" | "keyboard";
export type EventQueryType = "all" | EventType;

/** Rows to aggregate: one project, optional type and path, inclusive time range. */
export type HeatmapFilter = { projectId: string; type: EventQueryType; path?: string; from: number; to: number };

/** Grid the database buckets coordinates into (see `bucketGrid`). */
export type HeatmapGrid = { resolution: number; bucketWidth: number; bucketHeight: number; renderHeight: number };

/** Viewport source values grouped by the database; `pickBucket` turns each into a bucket. */
export type ViewportGroup = { explicit: unknown; w: unknown; h: unknown; count: number };

/** Per-type counts plus the largest non-scroll y (NULL y counts as 0; null when no such row). */
export type HeatmapSummary = { typeBreakdown: Record<string, number>; maxY: number | null };

/** What a dialect computes in the database. Only grouped rows reach Node. */
export type HeatmapBackend = {
  summary: (filter: HeatmapFilter) => Promise<HeatmapSummary>;
  /** Viewport sources of the `limit` most recent matching events. */
  viewportGroups: (filter: HeatmapFilter, limit: number, visit: (group: ViewportGroup) => void) => Promise<void>;
  buckets: (filter: HeatmapFilter, grid: HeatmapGrid) => Promise<Array<{ bx: number; by: number; count: number }>>;
};
