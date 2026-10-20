import { useCallback, type ReactNode } from "react";
import { fetchProjects, type ProjectListItem } from "../lib/api";
import { useListing } from "../lib/use-listing";
import EntryTable, { type Column } from "./EntryTable";

type Props = {
  collectorUrl: string;
  hrefFor: (project: ProjectListItem) => string;
  /** Shown when the collector has no project yet (the dashboard passes #24's onboarding). */
  empty?: ReactNode;
};

const number = (value: number) => new Intl.NumberFormat().format(value);

const columns: Column<ProjectListItem>[] = [
  {
    label: "Project",
    cell: (p) => (
      <span className="entry-name">
        <span
          className={p.receivingData ? "data-dot live" : "data-dot"}
          role="img"
          aria-label={p.receivingData ? "Receiving data" : "No data in the last 24 h"}
          title={
            p.lastEventAt
              ? `Last event ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(p.lastEventAt)}`
              : p.hasFutureEvents
                ? "Only future-dated events so far (check the site's clock)"
                : "No events yet"
          }
        />
        <span dir="auto">{p.name}</span>
      </span>
    )
  },
  { label: "Events (24 h)", numeric: true, cell: (p) => number(p.eventsLast24h) }
];

/** Dashboard home (#25): every project in this collector, with a receiving-data dot. */
export default function ProjectList({ collectorUrl, hrefFor, empty }: Props) {
  const load = useCallback(
    (cursor?: string | null) =>
      fetchProjects(collectorUrl, cursor).then((r) => ({ items: r.projects, nextCursor: r.meta.nextCursor })),
    [collectorUrl]
  );
  const listing = useListing(load);
  return (
    <EntryTable
      caption="Projects"
      testId="project-list"
      columns={columns}
      {...listing}
      onMore={listing.more}
      rowKey={(p) => p.id}
      rowHref={hrefFor}
      empty={empty ?? <p className="ph-empty">No projects yet. A project appears when its first event arrives.</p>}
    />
  );
}
