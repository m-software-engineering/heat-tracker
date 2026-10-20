/** Types shared by the heatmap aggregator and its dialect backends. */
export type EventType = "click" | "move" | "scroll" | "pageview" | "custom" | "input" | "keyboard";
export type EventQueryType = "all" | EventType;

/** Rows to aggregate: one project, optional type, path and viewport bucket, inclusive time range. */
export type HeatmapFilter = {
  projectId: string;
  type: EventQueryType;
  path?: string;
  viewport?: string;
  from: number;
  to: number;
};

/** Grid the database buckets coordinates into (see `bucketGrid`). */
export type HeatmapGrid = { resolution: number; bucketWidth: number; bucketHeight: number; renderHeight: number };

/** What a dialect computes in the database. Only grouped rows reach Node. */
export type HeatmapBackend = {
  typeCounts: (filter: HeatmapFilter) => Promise<Record<string, number>>;
  /** Largest y of positioned non-scroll rows; null when there is no such row. */
  maxY: (filter: HeatmapFilter) => Promise<number | null>;
  /** Plottable-type events with no position (no x/y and not a scroll with depth). */
  noCoordinates: (filter: HeatmapFilter) => Promise<number>;
  /** Stored buckets of the `limit` most recent matching events, with counts. */
  recentBuckets: (filter: HeatmapFilter, limit: number) => Promise<Record<string, number>>;
  /** Matching events per stored bucket ("" = none). */
  bucketCounts: (filter: HeatmapFilter) => Promise<Record<string, number>>;
  buckets: (filter: HeatmapFilter, grid: HeatmapGrid) => Promise<Array<{ bx: number; by: number; count: number }>>;
};
