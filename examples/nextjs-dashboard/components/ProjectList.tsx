import { useCallback } from "react";
import { fetchProjects, type ProjectSummary } from "../lib/api";
import { useListing } from "../lib/use-listing";
import EntryTable, { type Column } from "./EntryTable";

type Props = { collectorUrl: string; hrefFor: (project: ProjectSummary) => string };

const number = (value: number) => new Intl.NumberFormat().format(value);

const columns: Column<ProjectSummary>[] = [
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
export default function ProjectList({ collectorUrl, hrefFor }: Props) {
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
      empty={<p className="ph-empty">No projects yet. A project appears when its first event arrives.</p>}
    />
  );
}
