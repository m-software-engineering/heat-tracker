/**
 * Dashboard URLs for the entry flow (#25): home → ?project=<id> → ?project=<id>&path=<path> (heatmap).
 * `site` carries the tracked site's origin (a project is named after it, #24) so the heatmap can frame it.
 */
const href = (params: Record<string, string | undefined>) =>
  `?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])))}`;

export const siteOf = (projectName: string) => (/^https?:\/\//.test(projectName) ? projectName : undefined);

export const projectHref = (projectId: string, site?: string) => href({ project: projectId, site });

export const pageHref = (projectId: string, path: string, site?: string) => href({ project: projectId, path, site });
