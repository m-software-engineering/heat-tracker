import { test, expect } from "@playwright/test";
import express from "express";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "../packages/heat-collector/src/collector";

const startCollector = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-e2e-"));
  const dbFile = path.join(dir, "collector.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file: dbFile },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });

  const app = express();
  const sdkDir = path.resolve(__dirname, "../packages/heat-sdk/dist");

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <button id="btn">Click</button>
    <script>window.__INGEST_URL__ = window.location.origin + "/ingest";</script>
    <script type="module">
      import { init } from "/sdk/index.mjs";
      window.__tracker__ = init({ endpoint: window.__INGEST_URL__, projectKey: "dev-project-key" });
    </script>
  </body>
</html>`);
  });

  app.get("/micro", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script>window.__INGEST_URL__ = window.location.origin + "/ingest";</script>
    <script type="module">
      import { init } from "/sdk/index.mjs";
      window.__heatTrackerInit__ = init;
    </script>
  </body>
</html>`);
  });

  app.use("/sdk", express.static(sdkDir));
  app.use(collector.router);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  const port = typeof address === "string" ? 0 : address?.port ?? 0;

  return {
    url: `http://localhost:${port}`,
    dbFile,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test("SDK captures click and collector aggregates", async ({ page }) => {
  const collector = await startCollector();

  try {
    await page.goto(collector.url);
    await page.waitForFunction(() => {
      const tracker = (window as any).__tracker__;
      return tracker && typeof tracker.flush === "function";
    });
    await page.click("#btn");
    await page.evaluate(async () => {
      await (window as any).__tracker__.flush();
    });

    const db = new Database(collector.dbFile);
    const project = db.prepare("select id from projects where key = ?").get("dev-project-key") as {
      id: string;
    };

    const response = await fetch(
      `${collector.url}/api/projects/${project.id}/heatmap?path=/&type=click&resolution=64`
    );
    const data = await response.json();

    expect(data.points.length).toBeGreaterThan(0);
  } finally {
    await collector.close();
  }
});

test("SDK localStorage queues stay isolated for micro frontend trackers", async ({ page }) => {
  const collector = await startCollector();

  try {
    await page.goto(`${collector.url}/micro`);
    await page.waitForFunction(() => typeof (window as any).__heatTrackerInit__ === "function");

    await page.evaluate(async () => {
      const init = (window as any).__heatTrackerInit__;
      const endpoint = (window as any).__INGEST_URL__;
      const baseConfig = {
        endpoint,
        capture: {
          click: false,
          move: { enabled: false, throttleMs: 80 },
          scroll: false,
          pageview: false
        },
        batch: {
          storage: "localStorage",
          flushIntervalMs: 60_000
        }
      };

      const trackerA = init({ ...baseConfig, projectKey: "micro-project-a" });
      trackerA.track("micro-a");

      const trackerB = init({ ...baseConfig, projectKey: "micro-project-b" });
      await trackerB.flush();
      await trackerA.flush();
      await trackerA.shutdown();
      await trackerB.shutdown();
    });

    const db = new Database(collector.dbFile);
    const countForProject = (key: string) =>
      (
        db
          .prepare("select count(*) as count from events e join projects p on p.id = e.project_id where p.key = ?")
          .get(key) as { count: number }
      ).count;

    expect(countForProject("micro-project-a")).toBe(1);
    expect(countForProject("micro-project-b")).toBe(0);
  } finally {
    await collector.close();
  }
});
