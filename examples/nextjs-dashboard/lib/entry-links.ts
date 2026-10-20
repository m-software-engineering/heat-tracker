/** Dashboard URLs for the entry flow (#25): home → ?project=<id> → ?project=<id>&path=<path> (heatmap). */
export const projectHref = (projectId: string) => `?${new URLSearchParams({ project: projectId })}`;

export const pageHref = (projectId: string, path: string) => `?${new URLSearchParams({ project: projectId, path })}`;
