import express from "express";
import path from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "tsup";
import { createCollector } from "../../packages/heat-collector/src/collector";
import { checkFrame } from "../../examples/nextjs-dashboard/lib/frame-policy";

const listen = (app: express.Express) =>
  new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });

/** Bundles the dashboard test harness (React + PageHeatmap) once per run with tsup. */
export const bundleHarness = async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "heat-harness-"));
  await build({
    entry: { harness: path.resolve(__dirname, "../../examples/nextjs-dashboard/test/harness.ts") },
    outDir,
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    noExternal: [/.*/],
    dts: false,
    silent: true,
    config: false,
    define: { "process.env.NODE_ENV": '"production"' },
    esbuildOptions(options) {
      options.jsx = "automatic";
    }
  });
  return readFileSync(path.join(outDir, "harness.global.js"), "utf8");
};

const SITE_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Pricing</title>
    <style>body { margin: 0; height: 2000px; font-family: sans-serif; }
      #buy { position: absolute; left: 900px; top: 1300px; width: 160px; height: 48px; }</style>
  </head>
  <body>
    <h1>Pricing</h1>
    <button id="buy">Buy</button>
    <script type="module">
      import { init } from "/sdk/index.mjs";
      window.__tracker__ = init({ endpoint: location.origin + "/ingest", projectKey: "overlay-key" });
    </script>
  </body>
</html>`;

/**
 * Two origins share one collector: the tracked site (127.0.0.1) and the dashboard (localhost), so
 * the iframe is cross-origin exactly as in production.
 */
export const startOverlayStack = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-overlay-"));
  const dbFile = path.join(dir, "collector.db");
  const collector = await createCollector({ db: { dialect: "sqlite", file: dbFile }, auth: { mode: "projectKey" } });
  const bundle = await bundleHarness();

  const site = express();
  site.get(["/pricing", "/empty"], (_req, res) => res.type("html").send(SITE_PAGE));
  site.get("/blocked", (_req, res) =>
    res.set("Content-Security-Policy", "frame-ancestors 'none'").type("html").send(SITE_PAGE)
  );
  site.use("/sdk", express.static(path.resolve(__dirname, "../../packages/heat-sdk/dist")));
  site.use(collector.router);
  const siteServer = await listen(site);
  const siteOrigin = `http://127.0.0.1:${siteServer.port}`;

  const dashboard = express();
  const css = readFileSync(path.resolve(__dirname, "../../examples/nextjs-dashboard/app/globals.css"), "utf8");
  dashboard.get("/harness.js", (_req, res) => res.type("js").send(bundle));
  dashboard.get("/globals.css", (_req, res) => res.type("css").send(css));
  dashboard.get("/api/frame-check", async (req, res) => {
    res.json(await checkFrame(String(req.query.url), String(req.query.origin), [siteOrigin]));
  });
  // Static page: the harness reads project/path from location.search; only server-known values are injected.
  const page =
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Heatmap</title>` +
    `<link rel="stylesheet" href="/globals.css" /></head><body><main id="root"></main>` +
    `<script src="/site.js"></script><script src="/harness.js"></script></body></html>`;
  dashboard.get("/", (_req, res) => res.type("html").send(page));
  dashboard.get("/site.js", (_req, res) =>
    res.type("js").send(`window.__SITE_ORIGIN__ = ${JSON.stringify(siteOrigin)};`)
  );
  dashboard.use(collector.router);
  const dashboardServer = await listen(dashboard);

  return {
    dbFile,
    siteUrl: siteOrigin,
    dashboardUrl: `http://localhost:${dashboardServer.port}`,
    close: async () => {
      await siteServer.close();
      await dashboardServer.close();
    }
  };
};
