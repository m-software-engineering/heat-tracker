import { describe, it, expect } from "vitest";
import cors from "cors";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "./collector";

/**
 * Mirrors the Express quick-start host pattern (README + examples/express-collector):
 * `app.use("/ingest", cors())` then `app.use(collector.router)`, matching the bin's
 * ingest-only CORS in server-main. createCollector itself has no CORS option.
 */
const createQuickStartApp = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-express-qs-"));
  const collector = await createCollector({
    db: { dialect: "sqlite", file: path.join(dir, "test.db") },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });
  const app = express();
  // CORS only on ingest; read routes must not be exposed to other origins.
  app.use("/ingest", cors());
  app.use(collector.router);
  return app;
};

const buildPayload = () => {
  const ts = Date.now();
  return {
    sdk: { name: "test", version: "0" },
    session: { id: "session-cors", startedAt: ts, lastSeenAt: ts },
    events: [
      {
        eventId: "event-cors-1",
        sessionId: "session-cors",
        ts,
        path: "/",
        viewport: { w: 1200, h: 800, dpr: 1 },
        device: { ua: "test", platform: "mac", language: "en" },
        type: "click",
        x: 10,
        y: 20
      }
    ]
  };
};

describe("Express quick start CORS", () => {
  it("answers cross-origin preflight and POST /ingest with Access-Control-Allow-Origin", async () => {
    const app = await createQuickStartApp();
    const origin = "https://app.example.com";

    const preflight = await request(app)
      .options("/ingest")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type, x-project-key")
      .expect(204);

    expect(preflight.headers["access-control-allow-origin"]).toBeTruthy();
    expect(["*", origin]).toContain(preflight.headers["access-control-allow-origin"]);
    expect(String(preflight.headers["access-control-allow-headers"] || "").toLowerCase()).toContain("x-project-key");

    const ingest = await request(app)
      .post("/ingest")
      .set("Origin", origin)
      .set("x-project-key", "dev-project-key")
      .send(buildPayload())
      .expect(200);

    expect(ingest.headers["access-control-allow-origin"]).toBeTruthy();
    expect(["*", origin]).toContain(ingest.headers["access-control-allow-origin"]);
  });

  it("does not send Access-Control-Allow-Origin on cross-origin read routes", async () => {
    const app = await createQuickStartApp();
    const origin = "https://app.example.com";

    const ingest = await request(app)
      .post("/ingest")
      .set("Origin", origin)
      .set("x-project-key", "dev-project-key")
      .send(buildPayload())
      .expect(200);
    expect(ingest.headers["access-control-allow-origin"]).toBeTruthy();

    const projects = await request(app).get("/api/projects").expect(200);
    const projectId = projects.body.projects[0].id;

    const read = await request(app).get(`/api/projects/${projectId}/events`).set("Origin", origin);

    expect(read.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
