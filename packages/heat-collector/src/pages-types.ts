/** Shared shapes for the projects and pages endpoints (#25). */
export type PageTitle = { path: string; title: string; ts: number };

export type ProjectRow = {
  id: string;
  name: string;
  createdAt: number;
  eventsLast24h: number;
  lastEventAt: number | null;
};

/** `title` is the stored (latest-seen) title, null when the page never sent one. */
export type PageRow = { path: string; title: string | null; sessions: number; clicks: number };

/** Keyset positions: projects by (createdAt, id); pages by (sessions desc, path) inside a fixed window. */
export type ProjectCursor = { c: number; i: string };
export type PageCursor = { s: number; p: string; f: number; t: number };
