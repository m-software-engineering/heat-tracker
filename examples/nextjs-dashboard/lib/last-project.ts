/** The last-opened project, so returning visitors skip the project list (#29). */
export const LAST_PROJECT_STORAGE = "heat-dashboard:lastProject";

type Store = Pick<Storage, "getItem" | "setItem">;

export const rememberProject = (projectId: string, site: string | undefined, store: Store = localStorage) =>
  store.setItem(LAST_PROJECT_STORAGE, JSON.stringify({ projectId, site: site ?? null }));

export const lastProject = (store: Store = localStorage): { projectId: string; site?: string } | null => {
  try {
    const value = JSON.parse(store.getItem(LAST_PROJECT_STORAGE) ?? "null");
    if (typeof value?.projectId !== "string" || !value.projectId) return null;
    return { projectId: value.projectId, site: typeof value.site === "string" ? value.site : undefined };
  } catch {
    return null;
  }
};
