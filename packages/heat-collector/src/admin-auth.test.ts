import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector, type CollectorConfig } from "./collector";

const TOKEN = "heat_admin_test-token";
const KEY = "pk_onboarding_0123456789";

const createApp = async (overrides: Partial<CollectorConfig> = {}) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "heat-admin-")), "test.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file },
    auth: { mode: "projectKey" },
    logging: { level: "error" },
    ...overrides
  });
  const app = express();
  app.use(collector.router);
  app.get("/host-route", (_req, res) => res.json({ host: true }));
  return app;
};

const payload = () => {
  const ts = Date.now();
  return {
    sdk: { name: "heat-sdk", version: "test" },
    session: { id: "s-1", startedAt: ts, lastSeenAt: ts },
    events: [
      {
        eventId: "e-1",
        sessionId: "s-1",
        ts,
        path: "/",
        viewport: { w: 1200, h: 800, dpr: 1 },
        device: { ua: "test", platform: "linux", language: "en" },
        type: "click",
        x: 1,
        y: 2
      }
    ]
  };
};

afterEach(() => vi.restoreAllMocks());

describe("admin token on the read API", () => {
  it("answers 401 HEAT_E_ADMIN_TOKEN_MISSING without a token", async () => {
    const app = await createApp({ admin: { token: TOKEN } });
    const res = await request(app).get("/api/metrics").expect(401);
    expect(res.body.error).toMatchObject({
      code: "HEAT_E_ADMIN_TOKEN_MISSING",
      cause: "header Authorization is missing",
      fix: expect.stringContaining("docker compose exec collector heat-collector token"),
      status: 401
    });
    expect(res.body.error.message).toMatch(/\.$/);
  });

  it("answers 401 HEAT_E_ADMIN_TOKEN_INVALID for a wrong token", async () => {
    const app = await createApp({ admin: { token: TOKEN } });
    const res = await request(app).get("/api/metrics").set("Authorization", "Bearer nope").expect(401);
    expect(res.body.error.code).toBe("HEAT_E_ADMIN_TOKEN_INVALID");
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it("serves the read API with the right token", async () => {
    const app = await createApp({ admin: { token: TOKEN } });
    await request(app).get("/api/metrics").set("Authorization", `Bearer ${TOKEN}`).expect(200);
  });

  it("keeps ingest, /healthz and host routes open", async () => {
    const app = await createApp({ admin: { token: TOKEN } });
    await request(app).post("/ingest").set("x-project-key", KEY).send(payload()).expect(200);
    expect((await request(app).get("/healthz").expect(200)).body).toEqual({ ok: true });
    await request(app).get("/host-route").expect(200);
  });

  it("leaves the read API open when no admin token is configured", async () => {
    const app = await createApp();
    await request(app).get("/api/metrics").expect(200);
  });
});

describe("project created by first ingest", () => {
  it("reports null until the first event, then the project named after the origin", async () => {
    const app = await createApp({ admin: { token: TOKEN } });
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const before = await request(app).get(`/api/projects/by-key/${KEY}`).set(auth).expect(200);
    expect(before.body).toEqual({ project: null });

    await request(app)
      .post("/ingest")
      .set("x-project-key", KEY)
      .set("Origin", "https://shop.example.com")
      .send(payload())
      .expect(200);

    const after = await request(app).get(`/api/projects/by-key/${KEY}`).set(auth).expect(200);
    expect(after.body.project).toMatchObject({ name: "https://shop.example.com", id: expect.any(String) });
  });

  it('names the project "Default" when the request has no origin', async () => {
    const app = await createApp();
    await request(app).post("/ingest").set("x-project-key", KEY).send(payload()).expect(200);
    const res = await request(app).get(`/api/projects/by-key/${KEY}`).expect(200);
    expect(res.body.project.name).toBe("Default");
  });
});
