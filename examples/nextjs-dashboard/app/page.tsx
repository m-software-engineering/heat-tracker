"use client";

import { useEffect, useState } from "react";
import HeatmapView, { type HeatmapPoint } from "../components/HeatmapView";
import { fetchHeatmap } from "../lib/api";

export default function Page() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:4000");
  const [projectId, setProjectId] = useState("");
  const [path, setPath] = useState("/");
  const [type, setType] = useState("click");
  const [resolution, setResolution] = useState(128);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [max, setMax] = useState(1);
  const [status, setStatus] = useState("Idle");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      setStatus("Loading...");
      try {
        const data = await fetchHeatmap(baseUrl, projectId, {
          path,
          type,
          resolution: String(resolution)
        });
        if (!cancelled) {
          setPoints(data.points);
          setMax(Math.max(1, ...data.points.map((p) => p.value)));
          setStatus(`Loaded ${data.meta.total} events`);
        }
      } catch (err: any) {
        if (!cancelled) setStatus(err?.message || "Failed");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, projectId, path, type, resolution]);

  return (
    <main>
      <aside className="sidebar">
        <h1>Heat Tracker</h1>
        <nav>
          <a href="#">Projects</a>
          <a href="#">Heatmaps</a>
          <a href="#">Sessions</a>
          <a href="#">Settings</a>
        </nav>
        <div className="metric-card">
          <h3>Status</h3>
          <p>{status}</p>
        </div>
      </aside>

      <section>
        <div className="topbar">
          <strong>Heatmap View</strong>
          <span>Event type: {type}</span>
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
            Path
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <label className="control">
            Event Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="click">Click</option>
              <option value="move">Move</option>
              <option value="scroll">Scroll</option>
            </select>
          </label>
          <label className="control">
            Resolution
            <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
              <option value={64}>64</option>
              <option value={128}>128</option>
              <option value={256}>256</option>
            </select>
          </label>
        </div>

        <div className="canvas-panel" style={{ marginTop: 16 }}>
          <div className="canvas-background">Place a screenshot or iframe here</div>
          <HeatmapView points={points} max={max} />
        </div>
      </section>

      <aside className="metrics">
        <div className="metric-card">
          <h3>Total Points</h3>
          <p>{points.length}</p>
        </div>
        <div className="metric-card">
          <h3>Peak Intensity</h3>
          <p>{max}</p>
        </div>
        <div className="metric-card">
          <h3>Hint</h3>
          <p>Use the collector /api to power filters.</p>
        </div>
      </aside>
    </main>
  );
}
