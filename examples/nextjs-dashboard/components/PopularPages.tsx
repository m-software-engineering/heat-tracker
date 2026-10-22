import { useCallback, useState, type ReactNode } from "react";
import { fetchPages, type PopularPage } from "../lib/api";
import type { Copy } from "../lib/copy";
import { POLL_MS } from "../lib/use-first-event";
import { useListing } from "../lib/use-listing";
import { PERIOD_DAYS } from "../lib/view-state";
import EntryTable, { type Column } from "./EntryTable";
import LiveCheck from "./LiveCheck";

type Props = {
  collectorUrl: string;
  projectId: string;
  hrefFor: (page: PopularPage) => string;
  copy: Copy;
  locale?: string;
  /** Install snippet shown while the project has no pages yet. */
  snippet?: ReactNode;
};

const columnsFor = (locale: string | undefined): Column<PopularPage>[] => {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return [
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
};

/** "Change period": the period options, labelled by the browser's own unit formatting (no new copy). */
function PeriodPicker({
  copy,
  locale,
  days,
  onChange
}: {
  copy: Copy;
  locale?: string;
  days: number;
  onChange: (d: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = (d: number) =>
    new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).format(d);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {copy.changePeriod}
      </button>
    );
  }
  return (
    <label className="control">
      {copy.changePeriod}
      <select value={days} onChange={(e) => onChange(Number(e.target.value))}>
        {PERIOD_DAYS.map((d) => (
          <option key={d} value={d}>
            {label(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Most visited pages of a project, last 7 days by default, by title (#25). Rows open the page heatmap. */
export default function PopularPages({ collectorUrl, projectId, hrefFor, copy, locale, snippet }: Props) {
  const [days, setDays] = useState(7);
  const load = useCallback(
    (cursor?: string | null) =>
      fetchPages(collectorUrl, projectId, cursor, days).then((r) => ({
        items: r.pages,
        nextCursor: r.meta.nextCursor
      })),
    [collectorUrl, projectId, days]
  );
  const listing = useListing(load, POLL_MS);
  return (
    <>
      {listing.arrived && (
        <div data-testid="first-event-received">
          <LiveCheck copy={copy} received />
        </div>
      )}
      <EntryTable
        caption="Popular pages, by sessions"
        testId="popular-pages"
        columns={columnsFor(locale)}
        {...listing}
        copy={copy}
        onMore={listing.more}
        rowKey={(p) => p.path}
        rowHref={hrefFor}
        empty={
          <div className="entry-empty" data-testid="pages-empty">
            <p className="ph-empty">{copy.pagesEmpty}</p>
            <PeriodPicker copy={copy} locale={locale} days={days} onChange={setDays} />
            {snippet ? (
              <div data-testid="waiting-first-event">
                {snippet}
                <LiveCheck copy={copy} received={false} />
              </div>
            ) : null}
          </div>
        }
      />
    </>
  );
}
