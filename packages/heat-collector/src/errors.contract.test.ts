import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector, type CollectorConfig } from "./collector";

const PROJECT_KEY = "pk_live_0123456789abcdefa1b2";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXNlY3JldA";

const createApp = async (overrides: Partial<CollectorConfig> = {}) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "heat-errors-")), "test.db");
  const collector = await createCollector({
    db: { dialect: "sqlite", file },
    auth: { mode: "projectKey" },
    ...overrides
  });
  const app = express();
  app.set("trust proxy", true);
  app.use(collector.router);
  return app;
};

const captureLogs = () => {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: string) => {
      lines.push(String(line));
    });
  }
  return lines;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("collector error contract", () => {
  it("returns { error: HeatError } plus deprecated legacy fields", async () => {
    captureLogs();
    const app = await createApp();
    const res = await request(app).post("/ingest").send({}).expect(401);

    expect(res.body.error).toEqual({
      code: "HEAT_E_PROJECT_KEY_MISSING",
      message: "The ingest request has no project key.",
      cause: "header x-project-key is missing",
      fix: expect.stringMatching(/^Set projectKey/),
      docs: expect.stringMatching(/errors\.md#heat_e_project_key_missing$/),
      status: 401,
      requestId: res.headers["x-request-id"]
    });
    // Legacy fields: kept for one minor version.
    expect(res.body.code).toBe("missing_project_key");
    expect(res.body.message).toBe(res.body.error.message);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("names the query param, received value, and expected format", async () => {
    captureLogs();
    const app = await createApp();

    const invalid = await request(app).get("/api/projects/p/heatmap").query({ resolution: 1 }).expect(400);
    expect(invalid.body.error.code).toBe("HEAT_E_QUERY_INVALID");
    expect(invalid.body.error.cause).toMatch(/^resolution: received "1" \(.+8.*\)$/);
    expect(Object.keys(invalid.body.error.details.fieldErrors)).toEqual(["resolution"]);
    expect(invalid.body.details).toEqual(invalid.body.error.details);

    const from = await request(app).get("/api/projects/p/events").query({ from: "yesterday" }).expect(400);
    expect(from.body.error).toMatchObject({ code: "HEAT_E_QUERY_FROM", cause: expect.stringContaining('"yesterday"') });
    expect(from.body.code).toBe("invalid_from");

    const range = await request(app).get("/api/projects/p/sessions").query({ from: 20, to: 10 }).expect(400);
    expect(range.body.error).toMatchObject({ code: "HEAT_E_INVALID_TIME_RANGE", cause: "from=20 is later than to=10" });
  });

  it("reports payload schema errors with stable fieldErrors keys", async () => {
    captureLogs();
    const app = await createApp();
    const res = await request(app).post("/ingest").set("x-project-key", PROJECT_KEY).send({ events: [] }).expect(400);
    expect(res.body.error.code).toBe("HEAT_E_PAYLOAD_SCHEMA");
    expect(res.body.code).toBe("invalid_payload");
    expect(res.body.error.details.fieldErrors).toHaveProperty("session");
  });

  it("never leaks a full project key, IP, or JWT into logs or bodies", async () => {
    const logs = captureLogs();
    const limited = await createApp({ ingestion: { rateLimit: { windowMs: 10_000, max: 1 } } });
    const send = () =>
      request(limited)
        .post("/ingest")
        .set("x-project-key", PROJECT_KEY)
        .set("x-forwarded-for", "203.0.113.77")
        .send({});
    await send().expect(400);
    const rate = await request(limited)
      .post("/ingest")
      .set("x-project-key", PROJECT_KEY)
      .set("x-forwarded-for", "203.0.113.77")
      .send({})
      .expect(429);
    expect(rate.body.error.code).toBe("HEAT_E_RATE_LIMITED");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    const jwtApp = await createApp({
      auth: { mode: "jwt", jwksUrl: "https://example.invalid/jwks", issuer: "i", audience: "a" }
    });
    const jwt = await request(jwtApp)
      .post("/ingest")
      .set("x-project-key", PROJECT_KEY)
      .set("authorization", `Bearer ${JWT}`)
      .send({})
      .expect(401);
    expect(jwt.body.error).toMatchObject({ code: "HEAT_E_JWKS_FETCH", cause: expect.stringContaining("HTTP 503") });
    expect(jwt.body.code).toBe("invalid_jwt");

    const everything = [...logs, JSON.stringify(rate.body), JSON.stringify(jwt.body)].join("\n");
    expect(everything).toContain("pk_…a1b2");
    expect(everything).toContain("203.0.113.0");
    expect(everything).not.toContain(PROJECT_KEY);
    expect(everything).not.toContain("203.0.113.77");
    expect(everything).not.toContain(JWT);
    expect(everything).not.toContain(JWT.split(".")[2]);
  });
});
