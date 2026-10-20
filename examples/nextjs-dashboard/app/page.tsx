"use client";

import { useState } from "react";
import PageHeatmap from "../components/PageHeatmap";

export default function Page() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:4000");
  const [projectId, setProjectId] = useState("");
  const [siteOrigin, setSiteOrigin] = useState("");
  const [path, setPath] = useState("/");

  return (
    <main>
      <aside className="sidebar">
        <h1>Heat Tracker</h1>
        <nav aria-label="Sections">
          <a href="#">Projects</a>
          <a href="#">Heatmaps</a>
          <a href="#">Sessions</a>
          <a href="#">Settings</a>
        </nav>
      </aside>

      <section>
        <div className="topbar">
          <h2>Heatmap View</h2>
          <span>Clicks over your page</span>
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

        {projectId ? (
          <PageHeatmap collectorUrl={baseUrl} projectId={projectId} siteOrigin={siteOrigin} path={path} />
        ) : (
          <p className="ph-empty">Enter a Project ID to load the heatmap.</p>
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
