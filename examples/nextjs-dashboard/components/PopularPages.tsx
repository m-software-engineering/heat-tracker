import { useCallback, type ReactNode } from "react";
import { fetchPages, type PopularPage } from "../lib/api";
import { useListing } from "../lib/use-listing";
import EntryTable, { type Column } from "./EntryTable";

type Props = {
  collectorUrl: string;
  projectId: string;
  hrefFor: (page: PopularPage) => string;
  /** Install snippet shown while the project has no pages yet. */
  snippet?: ReactNode;
};

const WAIT_POLL_MS = 3000;
const number = (value: number) => new Intl.NumberFormat().format(value);

const columns: Column<PopularPage>[] = [
  {
    label: "Page",
    cell: (p) => (
      // Long titles truncate; the full title shows on hover (title) and focus (CSS), RTL/CJK safe.
      <span className="entry-title" title={p.title} dir="auto">
        {p.title}
      </span>
    )
  },
  {
    label: "Path",
    cell: (p) => (
      <code className="entry-path" title={p.path}>
        {p.path}
      </code>
    )
  },
  { label: "Sessions", numeric: true, cell: (p) => number(p.sessions) },
  { label: "Clicks", numeric: true, cell: (p) => number(p.clicks) }
];

/** Most visited pages of a project in the last 7 days, by title (#25). Rows open the page heatmap. */
export default function PopularPages({ collectorUrl, projectId, hrefFor, snippet }: Props) {
  const load = useCallback(
    (cursor?: string | null) =>
      fetchPages(collectorUrl, projectId, cursor).then((r) => ({ items: r.pages, nextCursor: r.meta.nextCursor })),
    [collectorUrl, projectId]
  );
  const listing = useListing(load, WAIT_POLL_MS);
  return (
    <>
      {listing.arrived && (
        <p role="status" className="waiting ready" data-testid="first-event-received">
          <span className="data-dot live" aria-hidden="true" /> First event received.
        </p>
      )}
      <EntryTable
        caption="Popular pages, last 7 days, by sessions"
        testId="popular-pages"
        columns={columns}
        {...listing}
        onMore={listing.more}
        rowKey={(p) => p.path}
        rowHref={hrefFor}
        empty={
          <div className="entry-empty" data-testid="waiting-first-event">
            {snippet}
            <p role="status" className="waiting">
              <span className="data-dot" aria-hidden="true" /> Waiting for your first event…
            </p>
          </div>
        }
      />
    </>
  );
}
