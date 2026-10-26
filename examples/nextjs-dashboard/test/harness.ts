// Browser entry for the dashboard e2e specs (bundled by e2e/fixtures/dashboard-server.ts): mounts the entry flow
// (ProjectList, PopularPages) and PageHeatmap without Next.js, and exposes the canvas renderer for the 100 k-point budget check.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import PageHeatmap from "../components/PageHeatmap";
import PopularPages from "../components/PopularPages";
import ProjectList from "../components/ProjectList";
import ProjectSnippet from "../components/ProjectSnippet";
import { pageHref, projectHref } from "../lib/entry-links";
import { renderHeatmap } from "../lib/heatmap-render";
import { COPY } from "../lib/copy";
import { renderShellState } from "./shell-states";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project");
const root = () => createRoot(document.getElementById("root")!);
const copy = COPY.en;
// Entry flow (#25): no project → project list; project without path → popular pages.
// ?shell=<state> renders one #29 shell state on its own (copy, a11y and axe checks).
if (params.has("shell")) {
  renderShellState(root(), params);
} else if (!projectId) {
  root().render(
    createElement(ProjectList, {
      collectorUrl: window.location.origin,
      hrefFor: (p) => projectHref(p.id),
      copy,
      createHref: "?shell=new-project"
    })
  );
} else if (!params.has("path")) {
  root().render(
    createElement(PopularPages, {
      collectorUrl: window.location.origin,
      projectId,
      hrefFor: (p) => pageHref(projectId, p.path),
      copy,
      snippet: createElement(ProjectSnippet, {
        publicCollectorUrl: window.location.origin,
        projectId,
        collectorUrl: window.location.origin,
        copy
      })
    })
  );
} else {
  const config = {
    collectorUrl: window.location.origin,
    projectId,
    // site=unlisted: a reachable origin that is not on the dashboard's allowlist.
    // site=down: an allowlisted origin with nothing listening (the frame check cannot reach it).
    siteOrigin: String(
      (window as unknown as Record<string, string>)[
        params.get("site") === "unlisted"
          ? "__UNLISTED_ORIGIN__"
          : params.get("site") === "down"
            ? "__DOWN_ORIGIN__"
            : "__SITE_ORIGIN__"
      ]
    ),
    path: params.get("path") ?? "/",
    // check=slow: a frame-check route that answers after the client budget.
    frameCheckUrl: params.get("check") === "slow" ? "/api/frame-check-slow" : "/api/frame-check"
  };
  // Full-width grid cell, like the dashboard's main column.
  const cell = { style: { gridColumn: "1 / -1", minWidth: 0 } };
  root().render(createElement("div", cell, createElement(PageHeatmap, config)));
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
