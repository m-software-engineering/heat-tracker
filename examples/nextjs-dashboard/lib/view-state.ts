/** Per-page view choices, kept in the URL so a link reproduces the same view. */
export type ViewportClass = "desktop" | "tablet" | "mobile";
export type ViewState = {
  /** null = the dominant viewport the collector picked. */
  viewport: ViewportClass | null;
  opacity: number;
  showHeatmap: boolean;
  view: "map" | "table";
  days: number;
};

export const VIEWPORT_BUCKETS: Record<ViewportClass, string> = {
  desktop: "1400x900",
  tablet: "800x1000",
  mobile: "400x800"
};

export const PERIOD_DAYS = [1, 7, 30, 90];
export const DEFAULT_VIEW: ViewState = { viewport: null, opacity: 60, showHeatmap: true, view: "map", days: 7 };

export const viewportClassOf = (width: number): ViewportClass =>
  width < 600 ? "mobile" : width < 1100 ? "tablet" : "desktop";

export type BucketCount = { bucket: string; count: number };
/** One viewport toggle option: the class's busiest stored bucket (the filter sent) and its event count. */
export type ViewportOption = { viewport: ViewportClass; bucket: string; count: number };

export const VIEWPORT_CLASSES: ViewportClass[] = ["desktop", "tablet", "mobile"];

/** Picks, per class, the bucket with the most events (falls back to VIEWPORT_BUCKETS with count 0). */
export const viewportOptions = (buckets: BucketCount[]): ViewportOption[] =>
  VIEWPORT_CLASSES.map((viewport) => {
    const top = buckets
      .filter((b) => viewportClassOf(Number(b.bucket.split("x")[0])) === viewport)
      .sort((a, b) => b.count - a.count)[0];
    return top ? { viewport, ...top } : { viewport, bucket: VIEWPORT_BUCKETS[viewport], count: 0 };
  });

const clampOpacity = (n: number) => Math.min(100, Math.max(0, Math.round(n / 5) * 5));

export const readViewState = (params: URLSearchParams): ViewState => {
  const viewport = params.get("viewport");
  const opacity = Number(params.get("opacity"));
  const days = Number(params.get("days"));
  return {
    viewport: viewport === "desktop" || viewport === "tablet" || viewport === "mobile" ? viewport : null,
    opacity: params.has("opacity") && Number.isFinite(opacity) ? clampOpacity(opacity) : DEFAULT_VIEW.opacity,
    showHeatmap: params.get("heat") !== "0",
    view: params.get("view") === "table" ? "table" : "map",
    days: PERIOD_DAYS.includes(days) ? days : DEFAULT_VIEW.days
  };
};

/** Writes only non-default values, so default links stay short. */
export const writeViewState = (params: URLSearchParams, state: ViewState) => {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => (value === null ? next.delete(key) : next.set(key, value));
  set("viewport", state.viewport);
  set("opacity", state.opacity === DEFAULT_VIEW.opacity ? null : String(clampOpacity(state.opacity)));
  set("heat", state.showHeatmap ? null : "0");
  set("view", state.view === "table" ? "table" : null);
  set("days", state.days === DEFAULT_VIEW.days ? null : String(state.days));
  return next;
};
