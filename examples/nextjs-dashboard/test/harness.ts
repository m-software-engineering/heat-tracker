// Browser entry for e2e/heatmap-overlay.e2e.spec.ts (bundled by e2e/fixtures/dashboard-server.ts): mounts the dashboard's PageHeatmap without Next.js,
// and exposes the canvas renderer for the 100 k-point budget check.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import PageHeatmap from "../components/PageHeatmap";
import { renderHeatmap } from "../lib/heatmap-render";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project");
if (projectId) {
  const config = {
    collectorUrl: window.location.origin,
    projectId,
    // site=unlisted: a reachable origin that is not on the dashboard's allowlist.
    siteOrigin: String(
      (window as unknown as Record<string, string>)[
        params.get("site") === "unlisted" ? "__UNLISTED_ORIGIN__" : "__SITE_ORIGIN__"
      ]
    ),
    path: params.get("path") ?? "/pricing"
  };
  // Full-width grid cell, like the dashboard's main column.
  const cell = { style: { gridColumn: "1 / -1", minWidth: 0 } };
  createRoot(document.getElementById("root")!).render(createElement("div", cell, createElement(PageHeatmap, config)));
}

(window as unknown as Record<string, unknown>).__renderBench = async (count: number) => {
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
  observer.observe({ type: "longtask", buffered: false });
  const points = Array.from({ length: count }, (_, i) => ({
    x: (i * 7919) % 1400,
    y: (i * 104729) % 4000,
    value: 1 + (i % 25)
  }));
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const ms = await renderHeatmap(canvas, points, { width: 1400, height: 4000, radius: 16 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  observer.disconnect();
  return { ms, maxLongTaskMs: Math.max(0, ...longTasks) };
};
