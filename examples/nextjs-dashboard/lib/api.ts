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
    excluded?: { noCoordinates: number };
    viewportBuckets?: Array<{ bucket: string; count: number }>;
  };
};

/** Collector errors are rethrown as-is (they are already catalog errors); anything else is HEAT_E_DASHBOARD_FETCH. */
const getJson = async (baseUrl: string, url: string) => {
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
  return body;
};

export const fetchHeatmap = async (baseUrl: string, projectId: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  const body = await getJson(baseUrl, `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/heatmap?${query}`);
  if (!body || !Array.isArray(body.points)) {
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, "collector response has no points array");
  }
  return body as HeatmapResponse;
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  eventsLast24h: number;
  lastEventAt: number | null;
  receivingData: boolean;
};

export type PopularPage = { path: string; title: string; hasTitle: boolean; sessions: number; clicks: number };

type Listing<K extends string, T> = { [key in K]: T[] } & { meta: { limit: number; nextCursor: string | null } };

const withCursor = (cursor?: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");

export const fetchProjects = async (baseUrl: string, cursor?: string | null) => {
  const body = await getJson(baseUrl, `${baseUrl}/api/projects${withCursor(cursor)}`);
  if (!body || !Array.isArray(body.projects)) {
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, "collector response has no projects array");
  }
  return body as Listing<"projects", ProjectSummary>;
};

export const fetchPages = async (baseUrl: string, projectId: string, cursor?: string | null) => {
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/pages${withCursor(cursor)}`;
  const body = await getJson(baseUrl, url);
  if (!body || !Array.isArray(body.pages)) {
    throw new HeatTrackerError(DASHBOARD_ERRORS.HEAT_E_DASHBOARD_FETCH, "collector response has no pages array");
  }
  return body as Listing<"pages", PopularPage>;
};
