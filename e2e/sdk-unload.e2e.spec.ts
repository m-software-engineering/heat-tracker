import { test, expect } from "@playwright/test";
import express from "express";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "../packages/heat-collector/src/collector";

type Stack = { url: string; dbFile: string; close: () => Promise<void> };

const startStack = async (): Promise<Stack> => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-unload-"));
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
<html><head><meta charset="utf-8" /></head>
<body>
  <a id="leave" href="/done">leave</a>
  <button id="btn">Click</button>
  <script>window.__INGEST_URL__ = window.location.origin + "/ingest";</script>
  <script type="module">
    import { init } from "/sdk/index.mjs";
    window.__tracker__ = init({
      endpoint: window.__INGEST_URL__, projectKey: "unload-key",
      batch: { flushIntervalMs: 60_000 },
      capture: { pageview: false, move: { enabled: false, throttleMs: 80 }, scroll: false }
    });
  </script>
</body></html>`);
  });
  app.get("/done", (_req, res) => res.type("html").send("<!doctype html><ok/>"));
  app.use("/sdk", express.static(sdkDir));

  app.use(collector.router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "string" ? 0 : (address?.port ?? 0);
  return {
    url: `http://localhost:${port}`,
    dbFile,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

const clickCount = (dbFile: string) => {
  const db = new Database(dbFile);
  try {
    return (db.prepare("select count(*) as n from events where type = 'click'").get() as { n: number }).n;
  } finally {
    db.close();
  }
};

test.describe("unload delivers each click exactly once", () => {
  for (let i = 1; i <= 5; i++) {
    test(`navigate-away #${i}`, async ({ page }) => {
      const stack = await startStack();
      try {
        await page.goto(stack.url);
        await page.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
        await page.click("#btn");
        expect(clickCount(stack.dbFile)).toBe(0);
        // Navigate without another click so only the button event is under test.
        await page.evaluate(() => {
          location.href = "/done";
        });
        await page.waitForURL("**/done");
        await expect.poll(() => clickCount(stack.dbFile)).toBe(1);
      } finally {
        await stack.close();
      }
    });
  }

  for (let i = 1; i <= 5; i++) {
    test(`close-tab #${i}`, async ({ page }) => {
      const stack = await startStack();
      try {
        await page.goto(stack.url);
        await page.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
        await page.click("#btn");
        expect(clickCount(stack.dbFile)).toBe(0);
        const closed = page.waitForEvent("close");
        await page.close({ runBeforeUnload: true });
        await closed;
        await expect.poll(() => clickCount(stack.dbFile)).toBe(1);
      } finally {
        await stack.close();
      }
    });
  }
});

test("rejected keepalive exit still delivers exactly once on the next page", async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-reject-"));
  const dbFile = path.join(dir, "collector.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file: dbFile },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });
  let rejectKeepalive = true;
  const app = express();
  const sdkDir = path.resolve(__dirname, "../packages/heat-sdk/dist");
  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html><body>
  <button id="btn">Click</button>
  <script>window.__INGEST_URL__ = window.location.origin + "/ingest";</script>
  <script type="module">
    import { init } from "/sdk/index.mjs";
    window.__tracker__ = init({
      endpoint: window.__INGEST_URL__, projectKey: "reject-key",
      batch: { flushIntervalMs: 60_000 },
      capture: { pageview: false, move: { enabled: false, throttleMs: 80 }, scroll: false }
    });
  </script>
</body></html>`);
  });
  app.use("/sdk", express.static(sdkDir));
  app.use("/ingest", (req, res, next) => {
    if (rejectKeepalive) {
      res
        .status(503)
        .type("json")
        .send(JSON.stringify({ error: { code: "HEAT_E_UNAVAILABLE", message: "reject keepalive" } }));
      req.resume();
      return;
    }
    next();
  });
  app.use(collector.router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://localhost:${port}`;
  try {
    await page.goto(url);
    await page.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
    await page.click("#btn");
    // Force exit flush; collector rejects it so the event stays in sessionStorage.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await expect.poll(() => clickCount(dbFile)).toBe(0);
    const queued = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.endsWith(":queue"));
      return key ? JSON.parse(sessionStorage.getItem(key)!) : [];
    });
    expect(queued.length).toBeGreaterThan(0);
    const eventId = queued.find((e: any) => e.type === "click")?.eventId;
    expect(eventId).toEqual(expect.any(String));

    rejectKeepalive = false;
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
    // Page re-inits tracker and restores the queue; wait for the replayed click.
    await expect.poll(() => clickCount(dbFile)).toBe(1);
    // A second reload must not double-count.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
    await expect.poll(() => clickCount(dbFile)).toBe(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
