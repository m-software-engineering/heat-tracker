import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { createCollector } from "./collector";
import { splitRange } from "./heatmap-sql";
import { ROLLUP_HOUR_MS } from "./heatmap-rollup";

const KEY = "rollup-key";
const HOUR = ROLLUP_HOUR_MS;
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % HOUR); // an hour boundary

// Closed after the file: Node 24 aborts when an unclosed native handle is finalized at worker exit.
const clients: Database.Database[] = [];
const open = () => {
  const client = new Database(":memory:");
  clients.push(client);
  return client;
};
afterAll(() => {
  for (const client of clients) client.close();
});

const collectorOn = async (client: Database.Database) => {
  const collector = await createCollector({ db: { dialect: "sqlite", client }, auth: { mode: "projectKey" } });
  const app = express();
  app.use(collector.router);
  return app;
};

const ingest = async (app: express.Express, client: Database.Database, events: any[]) => {
  await request(app)
    .post("/ingest")
    .set("x-project-key", KEY)
    .send({ session: { id: "s1", startedAt: T0, lastSeenAt: T0 }, events })
    .expect(200);
  return (client.prepare("select id from projects where key = ?").get(KEY) as any).id as string;
};

const click = (i: number, ts: number, x: number, y: number, w = 1440) => ({
  eventId: `c${i}`,
  sessionId: "s1",
  ts,
  path: "/",
  viewport: { w, h: 900 },
  device: {},
  type: "click",
  x,
  y
});

const heatmap = async (app: express.Express, projectId: string, query: Record<string, unknown>) =>
  (
    await request(app)
      .get(`/api/projects/${projectId}/heatmap`)
      .query({ path: "/", ...query })
      .expect(200)
  ).body;

describe("heatmap rollup", () => {
  it("splits a range into whole hours (rollup) and partial edges (raw)", () => {
    const base = { projectId: "p", type: "all" as const };
    expect(splitRange({ ...base, from: T0 + 10, to: T0 + 20 })).toEqual({
      raw: [{ ...base, from: T0 + 10, to: T0 + 20 }],
      rollup: undefined
    });
    expect(splitRange({ ...base, from: T0 - 5, to: T0 + 2 * HOUR + 5 })).toEqual({
      raw: [
        { ...base, from: T0 - 5, to: T0 - 1 },
        { ...base, from: T0 + 2 * HOUR, to: T0 + 2 * HOUR + 5 }
      ],
      rollup: { ...base, from: T0, to: T0 + HOUR }
    });
  });

  it("is maintained at ingest and merges with raw edges to the same counts", async () => {
    const client = open();
    const app = await collectorOn(client);
    const projectId = await ingest(app, client, [
      click(1, T0 + 1000, 10, 10),
      click(2, T0 + HOUR + 1000, 10, 10),
      click(3, T0 + HOUR + 2000, 700, 400, 390)
    ]);
    await ingest(app, client, [click(4, T0 + 1500, 10, 10)]);

    const rows = client.prepare("select hour_ts, x, y, vb, cnt from heatmap_rollup order by hour_ts, x").all();
    expect(rows).toEqual([
      { hour_ts: T0, x: 10, y: 10, vb: "1400x900", cnt: 2 },
      { hour_ts: T0 + HOUR, x: 10, y: 10, vb: "1400x900", cnt: 1 },
      { hour_ts: T0 + HOUR, x: 700, y: 400, vb: "400x900", cnt: 1 }
    ]);

    const whole = await heatmap(app, projectId, { from: T0, to: T0 + 2 * HOUR - 1, viewportBucket: "1400x900" });
    const mixed = await heatmap(app, projectId, { from: T0 + 1200, to: T0 + 2 * HOUR - 1, viewportBucket: "1400x900" });
    expect(whole.meta.plotted).toBe(4);
    expect(mixed.meta.plotted).toBe(3); // click 1 is before the raw edge starts
    expect(whole.points.find((p: any) => p.x < 20).value).toBe(3);
  });

  it("filters by viewport bucket and reports every bucket's count", async () => {
    const client = open();
    const app = await collectorOn(client);
    const projectId = await ingest(app, client, [
      click(1, T0 + 1000, 10, 10),
      click(2, T0 + 2000, 10, 10),
      click(3, T0 + 3000, 100, 100, 390)
    ]);

    const body = await heatmap(app, projectId, { from: T0, to: T0 + HOUR - 1, viewport: "400x900" });

    expect(body.meta).toMatchObject({ total: 1, plotted: 1, viewportFilter: "400x900", bucket: "400x900" });
    expect(body.meta.viewportBuckets).toEqual([
      { bucket: "1400x900", count: 2 },
      { bucket: "400x900", count: 1 }
    ]);
  });

  it("filters by several buckets at once; the first sets the grid", async () => {
    const client = new Database(":memory:");
    const app = await collectorOn(client);
    const projectId = await ingest(app, client, [
      click(1, T0 + 1000, 10, 10, 390),
      click(2, T0 + 2000, 10, 10, 420),
      click(3, T0 + 3000, 100, 100)
    ]);
    // 390 and 420 round to 400: use different heights for two buckets.
    client.exec("update events set viewport_bucket = '400x800' where ts = " + (T0 + 2000));
    // Documented rebuild: empty the rollup and mark every row pending.
    client.exec("delete from heatmap_rollup; update events set rollup_state = null");
    const migrated = await collectorOn(client);

    const body = await heatmap(migrated, projectId, { from: T0, to: T0 + HOUR - 1, viewport: "400x900,400x800" });

    expect(body.meta).toMatchObject({ total: 2, viewportFilter: "400x900,400x800", bucket: "400x900" });
  });

  it("defaults to the last 7 whole days and returns the applied range", async () => {
    const client = open();
    const app = await collectorOn(client);
    const now = Date.now();
    const projectId = await ingest(app, client, [click(1, now - 8 * 24 * HOUR, 10, 10), click(2, now, 20, 20)]);

    const body = await heatmap(app, projectId, {});

    const { from, to, defaulted } = body.meta.range;
    expect(defaulted).toBe(true);
    expect((to + 1) % HOUR).toBe(0);
    expect(to + 1 - from).toBe(7 * 24 * HOUR);
    expect(to).toBeGreaterThanOrEqual(now);
    expect(body.meta.total).toBe(1);
    const explicit = await heatmap(app, projectId, { from: 0 });
    expect(explicit.meta.range.defaulted).toBe(false);
    expect(explicit.meta.total).toBe(2);
  });

  it("migrates old events (bucket + rollup) and skips events without coordinates", async () => {
    const client = open();
    const app = await collectorOn(client);
    const projectId = await ingest(app, client, [click(1, T0 + 1000, 10, 10)]);
    // Rows written by an older collector (no viewport_bucket, rollup_state NULL), one click without coordinates.
    const insert = client.prepare(
      "insert into events (id, project_id, session_id, type, ts, path, x, y, meta_json) values (?, ?, 's1', 'click', ?, '/', ?, ?, ?)"
    );
    const meta = JSON.stringify({ viewport: { w: 1440, h: 900 }, meta: {} });
    insert.run("old-1", projectId, T0 + 2000, 30, 30, meta);
    insert.run("old-2", projectId, T0 + 3000, null, null, meta);

    const migrated = await collectorOn(client);
    const whole = await heatmap(migrated, projectId, { from: T0, to: T0 + HOUR - 1 });
    const raw = await heatmap(migrated, projectId, { from: T0 + 1, to: T0 + HOUR - 2 });

    expect(client.prepare("select count(*) as n from events where viewport_bucket is null").get()).toEqual({ n: 0 });
    for (const body of [whole, raw]) {
      expect(body.meta).toMatchObject({ total: 3, plotted: 2, excluded: { noCoordinates: 1 } });
      expect(body.points.every((p: any) => p.x > 0 && p.y > 0)).toBe(true);
    }
  });
});
