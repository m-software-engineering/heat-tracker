import type { KeyboardEvent, ReactNode } from "react";
import type { HeatError } from "@m-software-engineering/heat-errors";

export type Column<T> = { label: string; numeric?: boolean; cell: (item: T) => ReactNode };

type Props<T> = {
  caption: string;
  testId: string;
  columns: Column<T>[];
  items: T[] | null;
  error: HeatError | null;
  rowKey: (item: T) => string;
  rowHref: (item: T) => string;
  empty: ReactNode;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
};

const SKELETON_ROWS = 6;

/**
 * Table shared by the project list and popular pages (#25). The first cell of each row is a real link
 * (middle-click opens a tab); ArrowUp/ArrowDown move between rows and Enter follows the link.
 * While loading, skeleton rows keep the final layout.
 */
export default function EntryTable<T>(props: Props<T>) {
  const { columns, items, error } = props;

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a.entry-link"));
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "ArrowDown" ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1);
    links[next]?.focus();
    event.preventDefault();
  };

  if (error) {
    return (
      <div role="alert" className="ph-alert" data-code={error.code}>
        <strong>{error.code}</strong> {error.message} Cause: {error.cause}. Fix: {error.fix}
      </div>
    );
  }
  if (items && items.length === 0) return <>{props.empty}</>;

  return (
    <>
      <table className="entry-table" data-testid={props.testId} aria-busy={items === null}>
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={column.numeric ? "num" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {items === null
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={i} className="skeleton-row" aria-hidden="true">
                  {columns.map((column) => (
                    <td key={column.label} className={column.numeric ? "num" : undefined}>
                      <span className="skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            : items.map((item) => (
                <tr key={props.rowKey(item)}>
                  {columns.map((column, i) => (
                    <td key={column.label} className={column.numeric ? "num" : undefined}>
                      {i === 0 ? (
                        <a className="entry-link" href={props.rowHref(item)}>
                          {column.cell(item)}
                        </a>
                      ) : (
                        column.cell(item)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {props.hasMore && (
        <button type="button" className="entry-more" onClick={props.onMore} disabled={props.loadingMore}>
          {props.loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
    </>
  );
}
