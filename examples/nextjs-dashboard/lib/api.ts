export type HeatmapResponse = {
  points: Array<{ x: number; y: number; value: number }>;
  meta: { total: number; resolution: number; viewport: { w: number; h: number } };
};

export const fetchHeatmap = async (baseUrl: string, projectId: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/heatmap?${query}`);
  if (!res.ok) {
    throw new Error(`Heatmap query failed: ${res.status}`);
  }
  return (await res.json()) as HeatmapResponse;
};
