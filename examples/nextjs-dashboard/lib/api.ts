import { DASHBOARD_ERRORS, HeatTrackerError, isHeatError } from "@m-software-engineering/heat-errors";

export type HeatmapResponse = {
  points: Array<{ x: number; y: number; value: number }>;
  meta: {
    total: number;
    totalEvents: number;
    sampled: boolean;
    plotted: number;
    resolution: number;
    viewport: { w: number; h: number };
    renderHeight: number;
    bucket: string;
  };
};

/** Collector errors are rethrown as-is (they are already catalog errors); anything else is HEAT_E_DASHBOARD_FETCH. */
export const fetchHeatmap = async (baseUrl: string, projectId: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/heatmap?${query}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, `network error reaching ${baseUrl}`, {
      original: err
    });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (isHeatError(body?.error)) throw body.error;
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, `collector answered HTTP ${res.status}`);
  }
  if (!body || !Array.isArray(body.points)) {
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, "collector response has no points array");
  }
  return body as HeatmapResponse;
};
