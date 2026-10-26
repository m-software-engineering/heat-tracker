"use client";

import { useEffect, type ReactNode } from "react";
import { COPY, type Copy } from "../lib/copy";

type Props = {
  /** The route's only `h1`; also the start of its `<title>`. */
  heading: string;
  /** Pages link for the current (or last-opened) project; hidden when there is none. */
  pagesHref?: string;
  current: "projects" | "pages" | null;
  aside?: ReactNode;
  children: ReactNode;
  copy?: Copy;
};

export const routeTitle = (heading: string) => `${heading} · Heat Tracker`;

/** Dashboard chrome (#29): "Skip to content", two nav items (Projects, Pages), one `h1` and a unique title per route. */
export default function AppShell({ heading, pagesHref, current, aside, children, copy = COPY.en }: Props) {
  useEffect(() => {
    document.title = routeTitle(heading);
  }, [heading]);
  return (
    <>
      <a className="skip-link" href="#content">
        {copy.skipToContent}
      </a>
      <div className="shell">
        <header className="sidebar">
          <p className="brand">Heat Tracker</p>
          <nav aria-label="Sections">
            <a href="?projects" aria-current={current === "projects" ? "page" : undefined}>
              {copy.projects}
            </a>
            {pagesHref ? (
              <a href={pagesHref} aria-current={current === "pages" ? "page" : undefined}>
                {copy.pages}
              </a>
            ) : null}
          </nav>
        </header>
        <main id="content" tabIndex={-1}>
          <div className="topbar">
            <h1>{heading}</h1>
          </div>
          {children}
        </main>
        {aside}
      </div>
    </>
  );
}
