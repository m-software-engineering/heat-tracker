import { useCallback, type ReactNode } from "react";
import { fetchProjects, type ProjectListItem } from "../lib/api";
import type { Copy } from "../lib/copy";
import { useListing } from "../lib/use-listing";
import EntryTable, { type Column } from "./EntryTable";

type Props = {
  collectorUrl: string;
  hrefFor: (project: ProjectListItem) => string;
  copy: Copy;
  locale?: string;
  /** Where "Create project" goes (the new-project screen). */
  createHref: string;
  /** Replaces the default empty state (the e2e harness passes its own). */
  empty?: ReactNode;
};

const columnsFor = (copy: Copy, locale: string | undefined): Column<ProjectListItem>[] => [
  {
    label: copy.colProject,
    cell: (p) => (
      <span className="entry-name">
        <span
          className={p.receivingData ? "data-dot live" : "data-dot"}
          role="img"
          aria-label={p.receivingData ? copy.receivingData : copy.noData24h}
          title={
            p.lastEventAt
              ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(p.lastEventAt)
              : undefined
          }
        />
        <span dir="auto">{p.name}</span>
      </span>
    )
  }
];

/** Spec empty state (#29): only a title, one line and the "Create project" button. */
export function ProjectsEmpty({ copy, createHref }: { copy: Copy; createHref: string }) {
  return (
    <div className="onboarding-card" data-testid="projects-empty">
      <h2>{copy.projectsEmptyTitle}</h2>
      <p>{copy.projectsEmptyBody}</p>
      <a className="button" href={createHref}>
        {copy.createProject}
      </a>
    </div>
  );
}

/** Dashboard home (#25): projects, waiting-for-first-event ones first, then by activity (sorted by the collector). */
export default function ProjectList({ collectorUrl, hrefFor, copy, locale, createHref, empty }: Props) {
  const load = useCallback(
    (cursor?: string | null) =>
      fetchProjects(collectorUrl, cursor).then((r) => ({ items: r.projects, nextCursor: r.meta.nextCursor })),
    [collectorUrl]
  );
  const listing = useListing(load);
  return (
    <EntryTable
      caption={copy.projects}
      testId="project-list"
      columns={columnsFor(copy, locale)}
      {...listing}
      copy={copy}
      onMore={listing.more}
      rowKey={(p) => p.id}
      rowHref={hrefFor}
      empty={empty ?? <ProjectsEmpty copy={copy} createHref={createHref} />}
    />
  );
}
