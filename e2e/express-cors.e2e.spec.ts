import { test, expect } from "@playwright/test";
import cors from "cors";
import express from "express";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "../packages/heat-collector/src/collector";

const listen = (app: express.Express) =>
  new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

const portOf = (server: Server) => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return address.port;
};

/**
 * Page+SDK on one origin, Express quick-start collector (with `app.use(cors())`) on another.
 * Proves the browser can ingest cross-origin without HEAT_E_INGEST_NETWORK.
 */
test("SDK on another origin ingests through Express quick-start CORS", async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-cors-e2e-"));
  const dbFile = path.join(dir, "collector.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file: dbFile },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });

  const collectorApp = express();
  collectorApp.use(cors());
  collectorApp.use(collector.router);
  const collectorServer = await listen(collectorApp);
  const collectorUrl = `http://127.0.0.1:${portOf(collectorServer)}`;

  const sdkDir = path.resolve(__dirname, "../packages/heat-sdk/dist");
  const pageApp = express();
  pageApp.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <button id="btn">Click</button>
    <script>window.__INGEST_URL__ = ${JSON.stringify(`${collectorUrl}/ingest`)};</script>
    <script type="module">
      import { init } from "/sdk/index.mjs";
      window.__tracker__ = init({ endpoint: window.__INGEST_URL__, projectKey: "dev-project-key" });
    </script>
  </body>
</html>`);
  });
  pageApp.use("/sdk", express.static(sdkDir));
  const pageServer = await listen(pageApp);
  const pageUrl = `http://127.0.0.1:${portOf(pageServer)}`;

  try {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await page.goto(pageUrl);
    await page.waitForFunction(() => {
      const tracker = (window as any).__tracker__;
      return tracker && typeof tracker.flush === "function";
    });
    await page.click("#btn");
    await page.evaluate(async () => {
      await (window as any).__tracker__.flush();
    });

    expect(pageErrors.join("\n")).not.toMatch(/HEAT_E_INGEST_NETWORK|Access-Control-Allow-Origin|Failed to fetch/i);

    const db = new Database(dbFile);
    const project = db.prepare("select id from projects where key = ?").get("dev-project-key") as
      | { id: string }
      | undefined;
    expect(project).toBeTruthy();

    const events = db.prepare("select count(*) as n from events where project_id = ?").get(project!.id) as {
      n: number;
    };
    expect(events.n).toBeGreaterThan(0);
  } finally {
    await Promise.all([
      new Promise<void>((r) => collectorServer.close(() => r())),
      new Promise<void>((r) => pageServer.close(() => r()))
    ]);
    collector.close();
  }
});
