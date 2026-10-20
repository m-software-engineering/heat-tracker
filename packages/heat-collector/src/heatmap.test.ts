import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "./collector";
import { autoMigrate, createDb } from "./db";
import { pickBucket } from "./viewport-bucket";
import { HEATMAP_INDEX } from "./schema";

const KEY = "heatmap-key";

const setup = async () => {
  const client = new Database(path.join(mkdtempSync(path.join(tmpdir(), "heat-heatmap-")), "h.db"));
  const collector = await createCollector({ db: { dialect: "sqlite", client }, auth: { mode: "projectKey" } });
  const app = express();
  app.use(collector.router);
  const ingest = async (events: any[]) => {
    const ts = Date.now();
    await request(app)
      .post("/ingest")
      .set("x-project-key", KEY)
      .send({ session: { id: "s1", startedAt: ts, lastSeenAt: ts }, events })
      .expect(200);
    return (client.prepare("select id from projects where key = ?").get(KEY) as any).id as string;
  };
  return { app, client, ingest };
};

const click = (i: number, x: number, y: number) => ({
  eventId: `c${i}`,
  sessionId: "s1",
  ts: Date.now(),
  path: "/",
  viewport: { w: 1440, h: 900 },
  device: {},
  type: "click",
  x,
  y
});

describe("heatmap aggregation", () => {
  it("reports totalEvents and sampled=false so the UI can mark partial data", async () => {
    const { app, ingest } = await setup();
    const projectId = await ingest([click(1, 10, 10), click(2, 10, 10), click(3, 700, 400)]);

    const res = await request(app).get(`/api/projects/${projectId}/heatmap`).query({ path: "/" }).expect(200);

    expect(res.body.meta).toMatchObject({ totalEvents: 3, total: 3, sampled: false, plotted: 3, bucket: "1400x900" });
    expect(res.body.points).toHaveLength(2);
    expect(res.body.points.reduce((sum: number, p: any) => sum + p.value, 0)).toBe(3);
  });

  it("returns an empty heatmap without running bucket queries when nothing matches", async () => {
    const { app, ingest } = await setup();
    const projectId = await ingest([click(1, 10, 10)]);

    const res = await request(app).get(`/api/projects/${projectId}/heatmap`).query({ path: "/none" }).expect(200);

    expect(res.body.points).toEqual([]);
    expect(res.body.meta).toMatchObject({ totalEvents: 0, sampled: false, bucket: "1280x720", renderHeight: 720 });
    expect(res.body.meta.warning).toBeUndefined();
  });

  it.each([
    ["viewportBucket", { viewportBucket: "wide" }, /^viewportBucket: received "wide" \(expected <width>x<height>/],
    ["viewportBucket", { viewportBucket: "0x900" }, /^viewportBucket: received "0x900"/],
    ["resolution", { resolution: "4096" }, /^resolution: received "4096"/],
    ["type", { type: "hover" }, /^type: received "hover"/]
  ])("rejects an invalid %s with HEAT_E_QUERY_INVALID naming the param", async (param, query, cause) => {
    const { app } = await setup();

    const res = await request(app).get("/api/projects/p/heatmap").query(query).expect(400);

    expect(res.body.error.code).toBe("HEAT_E_QUERY_INVALID");
    expect(res.body.error.cause).toMatch(cause);
    expect(Object.keys(res.body.error.details.fieldErrors)).toEqual([param]);
  });

  it("creates the (project, path, type, ts) index and migrating twice is a no-op", async () => {
    const client = new Database(":memory:");
    const ctx = await createDb({ dialect: "sqlite", client });
    await autoMigrate(ctx);
    await autoMigrate(ctx);

    const columns = client.prepare(`PRAGMA index_info(${HEATMAP_INDEX})`).all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toEqual(["project_id", "path", "type", "ts"]);
  });

  it("uses the explicit meta.viewportBucket before the rounded viewport", () => {
    expect(pickBucket({ explicit: "390x844", w: 1440, h: 900 })).toBe("390x844");
    expect(pickBucket({ explicit: "nope", w: "1449", h: "861" })).toBe("1400x900");
    expect(pickBucket({ explicit: null, w: null, h: null })).toBeUndefined();
    expect(pickBucket({ explicit: undefined, w: 0, h: 900 })).toBeUndefined();
  });
});
