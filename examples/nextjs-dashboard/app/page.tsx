"use client";

import { useEffect, useState } from "react";
import PageHeatmap from "../components/PageHeatmap";
import PopularPages from "../components/PopularPages";
import ProjectList from "../components/ProjectList";
import { pageHref, projectHref } from "../lib/entry-links";

export default function Page() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:4000");
  const [projectId, setProjectId] = useState("");
  const [siteOrigin, setSiteOrigin] = useState("");
  const [path, setPath] = useState("");

  // The entry flow lives in the URL (?project=…&path=…) so rows are real links.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setProjectId(params.get("project") ?? "");
    setPath(params.get("path") ?? "");
  }, []);

  return (
    <main>
      <aside className="sidebar">
        <h1>Heat Tracker</h1>
        <nav aria-label="Sections">
          <a href="?">Projects</a>
          <a href="#">Heatmaps</a>
          <a href="#">Sessions</a>
          <a href="#">Settings</a>
        </nav>
      </aside>

      <section>
        <div className="topbar">
          <h2>{!projectId ? "Projects" : !path ? "Popular pages" : "Heatmap View"}</h2>
          <span>{!projectId ? "Pick a project" : !path ? "Last 7 days, by sessions" : "Clicks over your page"}</span>
        </div>

        <div className="controls">
          <label className="control">
            Collector Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="control">
            Project ID
            <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="uuid" />
          </label>
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

        {!projectId ? (
          <ProjectList collectorUrl={baseUrl} hrefFor={(p) => projectHref(p.id)} />
        ) : !path ? (
          <PopularPages collectorUrl={baseUrl} projectId={projectId} hrefFor={(p) => pageHref(projectId, p.path)} />
        ) : (
          <PageHeatmap collectorUrl={baseUrl} projectId={projectId} siteOrigin={siteOrigin} path={path} />
        )}
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
