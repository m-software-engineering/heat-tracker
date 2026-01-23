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
