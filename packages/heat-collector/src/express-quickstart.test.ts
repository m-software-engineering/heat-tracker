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
 * `app.use(cors())` then `app.use(collector.router)`, matching NestJS `app.enableCors()`.
 * createCollector itself has no CORS option; the heat-collector bin enables ingest CORS in
 * server-main only.
 */
const createQuickStartApp = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-express-qs-"));
  const collector = await createCollector({
    db: { dialect: "sqlite", file: path.join(dir, "test.db") },
    auth: { mode: "projectKey" },
    autoMigrate: true
  });
  const app = express();
  app.use(cors());
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

    // Default `cors()` mirrors NestJS `enableCors()`: `*` (or the request origin).
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
});
