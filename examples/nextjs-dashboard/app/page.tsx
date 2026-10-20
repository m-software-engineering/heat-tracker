"use client";

import { useCallback, useEffect, useState } from "react";
import CollectorUnreachable from "../components/CollectorUnreachable";
import Onboarding from "../components/Onboarding";
import PageHeatmap from "../components/PageHeatmap";
import TokenForm from "../components/TokenForm";
import type { ProjectSummary, SessionState } from "../lib/onboarding";

/** Collector calls go through the dashboard server (app/api/collector), which adds the admin token. */
const PROXY_URL = "/api/collector";

export default function Page() {
  const [session, setSession] = useState<SessionState>();
  const [project, setProject] = useState<ProjectSummary>();
  const [siteOrigin, setSiteOrigin] = useState("");
  const [path, setPath] = useState("/");

  const loadSession = useCallback(async () => {
    setSession(undefined);
    const res = await fetch("/api/session", { cache: "no-store" });
    setSession(await res.json());
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const onProject = useCallback((found: ProjectSummary) => {
    setProject(found);
    setSiteOrigin((current) => current || (found.name.startsWith("http") ? found.name : ""));
  }, []);

  const unreachable = session?.error?.code === "HEAT_E_COLLECTOR_UNREACHABLE" ? session.error : undefined;

  return (
    <main>
      <aside className="sidebar">
        <h1>Heat Tracker</h1>
      </aside>

      <section>
        <div className="topbar">
          <h2>Heatmap View</h2>
          <span>Clicks over your page</span>
        </div>

        {!session ? <p className="ph-empty">Loading…</p> : null}
        {unreachable ? <CollectorUnreachable error={unreachable} onRetry={loadSession} /> : null}
        {session && !unreachable && !session.signedIn ? <TokenForm onSignedIn={loadSession} /> : null}
        {session?.signedIn ? (
          <>
            <Onboarding publicCollectorUrl={session.publicCollectorUrl} onProject={onProject} />
            {project ? (
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
                  <label className="control">
                    Path
                    <input value={path} onChange={(e) => setPath(e.target.value)} />
                  </label>
                </div>
                <PageHeatmap collectorUrl={PROXY_URL} projectId={project.id} siteOrigin={siteOrigin} path={path} />
              </>
            ) : null}
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
