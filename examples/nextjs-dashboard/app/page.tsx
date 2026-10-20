"use client";

import { useCallback, useEffect, useState } from "react";
import CollectorUnreachable from "../components/CollectorUnreachable";
import Onboarding from "../components/Onboarding";
import PageHeatmap from "../components/PageHeatmap";
import PopularPages from "../components/PopularPages";
import ProjectList from "../components/ProjectList";
import ProjectSnippet from "../components/ProjectSnippet";
import TokenForm from "../components/TokenForm";
import { pageHref, projectHref, siteOf } from "../lib/entry-links";
import type { ProjectSummary, SessionState } from "../lib/onboarding";

/** Collector calls go through the dashboard server (app/api/collector), which adds the admin token. */
const PROXY_URL = "/api/collector";

export default function Page() {
  const [session, setSession] = useState<SessionState>();
  const [projectId, setProjectId] = useState("");
  const [siteOrigin, setSiteOrigin] = useState("");
  const [path, setPath] = useState("");
  const [onboarded, setOnboarded] = useState<ProjectSummary>();

  const loadSession = useCallback(async () => {
    setSession(undefined);
    const res = await fetch("/api/session", { cache: "no-store" });
    setSession(await res.json());
  }, []);

  useEffect(() => {
    void loadSession();
    // The entry flow lives in the URL (?project=…&path=…) so rows are real links.
    const params = new URLSearchParams(window.location.search);
    setProjectId(params.get("project") ?? "");
    setPath(params.get("path") ?? "");
    setSiteOrigin(params.get("site") ?? "");
  }, [loadSession]);

  // First event for the onboarding key: Onboarding shows "Receiving events from …"; link on to its pages.
  const onProject = useCallback((found: ProjectSummary) => setOnboarded(found), []);

  const unreachable = session?.error?.code === "HEAT_E_COLLECTOR_UNREACHABLE" ? session.error : undefined;
  const site = siteOrigin || undefined;

  return (
    <main>
      <aside className="sidebar">
        <h1>Heat Tracker</h1>
        <nav aria-label="Sections">
          <a href="?">Projects</a>
        </nav>
      </aside>

      <section>
        <div className="topbar">
          <h2>{!projectId ? "Projects" : !path ? "Popular pages" : "Heatmap View"}</h2>
          <span>{!projectId ? "Pick a project" : !path ? "Last 7 days, by sessions" : "Clicks over your page"}</span>
        </div>

        {!session ? <p className="ph-empty">Loading…</p> : null}
        {unreachable ? <CollectorUnreachable error={unreachable} onRetry={loadSession} /> : null}
        {session && !unreachable && !session.signedIn ? <TokenForm onSignedIn={loadSession} /> : null}
        {session?.signedIn && !projectId ? (
          <ProjectList
            collectorUrl={PROXY_URL}
            hrefFor={(p) => projectHref(p.id, siteOf(p.name))}
            empty={
              <>
                <Onboarding publicCollectorUrl={session.publicCollectorUrl} onProject={onProject} />
                {onboarded ? <a href={projectHref(onboarded.id, siteOf(onboarded.name))}>Open popular pages</a> : null}
              </>
            }
          />
        ) : null}
        {session?.signedIn && projectId && !path ? (
          <PopularPages
            collectorUrl={PROXY_URL}
            projectId={projectId}
            hrefFor={(p) => pageHref(projectId, p.path, site)}
            snippet={
              <ProjectSnippet
                publicCollectorUrl={session.publicCollectorUrl}
                projectId={projectId}
                collectorUrl={PROXY_URL}
              />
            }
          />
        ) : null}
        {session?.signedIn && projectId && path ? (
          <>
            <div className="controls">
              <label className="control">
                Site URL
                <input
                  value={siteOrigin}
                  onChange={(e) => setSiteOrigin(e.target.value)}
                  placeholder="https://your-site.example"
                />
              </label>
            </div>
            <PageHeatmap collectorUrl={PROXY_URL} projectId={projectId} siteOrigin={siteOrigin} path={path} />
          </>
        ) : null}
      </section>

      <aside className="metrics">
        <div className="metric-card">
          <h3>Keyboard</h3>
          <p>H toggles the heatmap; [ and ] change opacity.</p>
        </div>
      </aside>
    </main>
  );
}
