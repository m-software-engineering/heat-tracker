/** Shared shapes for the projects and pages endpoints (#25). */
export type PageTitle = { path: string; title: string; ts: number };

export type ProjectRow = {
  id: string;
  name: string;
  /** Returned because `GET /api/projects` is admin-only (#24): the dashboard builds the snippet from it. */
  projectKey: string;
  createdAt: number;
  eventsLast24h: number;
  lastEventAt: number | null;
};

/** `title` is the stored (latest-seen) title, null when the page never sent one. */
export type PageRow = { path: string; title: string | null; sessions: number; clicks: number };

/**
 * Keyset positions. Projects: (k desc, id) where k is the last event ts, or NO_EVENTS_SORT_KEY for a
 * project with no events (listed first), computed as of the snapshot `s` (first page's "now"): later
 * events and projects are ignored, so ingest between pages cannot move a row across the cursor. Pages: (sessions desc, path) inside a fixed window.
 */
export type ProjectCursor = { k: number; i: string; s: number };
export const DAY_MS = 86_400_000;
export const NO_EVENTS_SORT_KEY = Number.MAX_SAFE_INTEGER;
export const projectSortKey = (p: { lastEventAt: number | null }) => p.lastEventAt ?? NO_EVENTS_SORT_KEY;
export type PageCursor = { s: number; p: string; f: number; t: number };
