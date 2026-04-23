import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "./collector";

const createApp = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-collector-"));
  const dbFile = path.join(dir, "test.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file: dbFile },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });
  const app = express();
  app.use(collector.router);
  return { app, dbFile };
};

const buildPayload = () => {
  const ts = Date.now();
  return {
    sdk: { name: "test", version: "0" },
    session: { id: "session-1", startedAt: ts, lastSeenAt: ts },
    events: [
      {
        eventId: "event-1",
        sessionId: "session-1",
        ts,
        path: "/",
        viewport: { w: 1200, h: 800, dpr: 2 },
        device: { ua: "test", platform: "mac", language: "en" },
        type: "click",
        x: 100,
        y: 200
      }
    ]
  };
};

describe("heat-collector", () => {
  it("ingests events and serves heatmap + sessions", async () => {
    const { app, dbFile } = await createApp();

    await request(app)
      .post("/ingest")
      .set("x-project-key", "dev-project-key")
      .send(buildPayload())
      .expect(200);

    const db = new Database(dbFile);
    const project = db.prepare("select id from projects where key = ?").get("dev-project-key") as any;
    expect(project).toBeTruthy();

    const heatmap = await request(app)
      .get(`/api/projects/${project.id}/heatmap`)
      .query({ path: "/", type: "click", resolution: 64 })
      .expect(200);

    expect(heatmap.body.points.length).toBeGreaterThan(0);

    const sessions = await request(app)
      .get(`/api/projects/${project.id}/sessions`)
      .query({ limit: 10 })
      .expect(200);

    expect(sessions.body.sessions.length).toBe(1);

    const detail = await request(app)
      .get("/api/sessions/session-1")
      .query({ limit: 10 })
      .expect(200);

    expect(detail.body.events.length).toBe(1);

    const events = await request(app)
      .get(`/api/projects/${project.id}/events`)
      .query({ limit: 10 })
      .expect(200);

    expect(events.body.events.length).toBe(1);
    expect(events.body.meta.count).toBe(1);

    const metrics = await request(app).get("/api/metrics").expect(200);
    expect(metrics.body.metrics.ingestCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid payloads", async () => {
    const { app } = await createApp();

    await request(app)
      .post("/ingest")
      .set("x-project-key", "dev-project-key")
      .send({})
      .expect(400);
  });

  it("enforces rate limits", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "heat-collector-"));
    const dbFile = path.join(dir, "test.db");
    const collector = await createCollector({
      db: { dialect: "sqlite", file: dbFile },
      auth: { mode: "projectKey" },
      autoMigrate: true,
      ingestion: { rateLimit: { windowMs: 10_000, max: 1 } }
    });
    const app = express();
    app.use(collector.router);

    await request(app)
      .post("/ingest")
      .set("x-project-key", "rate-limit-key")
      .send(buildPayload())
      .expect(200);

    await request(app)
      .post("/ingest")
      .set("x-project-key", "rate-limit-key")
      .send(buildPayload())
      .expect(429);
  });

  it("returns structured query errors and request id headers", async () => {
    const { app } = await createApp();

    const res = await request(app)
      .get("/api/projects/project-id/heatmap")
      .query({ resolution: 1 })
      .expect(400);

    expect(res.body.code).toBe("invalid_query");
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("keeps heatmap y points when click coordinates exceed viewport height", async () => {
    const { app, dbFile } = await createApp();
    const payload = buildPayload();
    payload.events[0].y = 1500;

    await request(app)
      .post("/ingest")
      .set("x-project-key", "dev-project-key")
      .send(payload)
      .expect(200);

    const db = new Database(dbFile);
    const project = db.prepare("select id from projects where key = ?").get("dev-project-key") as any;

    const heatmap = await request(app)
      .get(`/api/projects/${project.id}/heatmap`)
      .query({ path: "/", type: "click", resolution: 64 })
      .expect(200);

    expect(heatmap.body.meta.renderHeight).toBe(1500);
    expect(heatmap.body.points[0].y).toBeGreaterThan(800);
  });

  it("maps scroll depth to heatmap using full height", async () => {
    const { app, dbFile } = await createApp();
    const ts = Date.now();
    const payload = {
      sdk: { name: "test", version: "0" },
      session: { id: "session-2", startedAt: ts, lastSeenAt: ts },
      events: [
        {
          eventId: "event-scroll-1",
          sessionId: "session-2",
          ts,
          path: "/",
          viewport: { w: 1200, h: 800, dpr: 2 },
          device: { ua: "test", platform: "mac", language: "en" },
          type: "scroll",
          scrollY: 0,
          scrollDepthPct: 50
        }
      ]
    };

    await request(app)
      .post("/ingest")
      .set("x-project-key", "dev-project-key")
      .send(payload)
      .expect(200);

    const db = new Database(dbFile);
    const project = db.prepare("select id from projects where key = ?").get("dev-project-key") as any;

    const heatmap = await request(app)
      .get(`/api/projects/${project.id}/heatmap`)
      .query({ path: "/", type: "scroll", resolution: 64 })
      .expect(200);

    expect(heatmap.body.points[0].y).toBeGreaterThan(300);
    expect(heatmap.body.points[0].y).toBeLessThan(500);
  });
});
