/** Name for a project created by its first ingest: the sending page's origin, else "Default". */
export const projectNameFromOrigin = (origin: string | undefined) => {
  if (!origin || origin === "null") return "Default";
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "Default";
  } catch {
    return "Default";
  }
};
