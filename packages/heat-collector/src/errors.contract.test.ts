import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector, type CollectorConfig } from "./collector";
import { resetLegacyWarningForTests } from "./http-errors";

const PROJECT_KEY = "pk_live_0123456789abcdefa1b2";
// Built at runtime: an unsigned test token, not a credential.
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const JWT = [b64({ alg: "RS256" }), b64({ sub: "u1" }), Buffer.from("signature-secret").toString("base64url")].join(
  "."
);

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
    expect(typeof res.body.error).toBe("object"); // legacy `error` string removed
    expect(res.headers.deprecation).toBe("true");
    expect(res.headers.link).toBe(
      '<https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md#migrating-from-legacy-fields>; rel="deprecation"'
    );
    // Legacy fields: removed in the next major.
    expect(res.body.code).toBe("missing_project_key");
    expect(res.body.message).toBe(res.body.error.message);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("logs the legacy-field deprecation warning once per process, naming the new fields", async () => {
    resetLegacyWarningForTests();
    const logs = captureLogs();
    const app = await createApp();
    await request(app).post("/ingest").send({}).expect(401);
    await request(app).get("/api/projects/p/heatmap").query({ resolution: 1 }).expect(400);
    const second = await createApp();
    await request(second).post("/ingest").send({}).expect(401);

    const warnings = logs.filter((line) => line.includes("deprecated top-level"));
    expect(warnings).toHaveLength(1);
    for (const field of ["code", "message", "requestId", "details"]) {
      expect(warnings[0]).toContain(`${field} -> error.${field}`);
    }
  });

  it("returns the new shape for malformed JSON (no legacy error string)", async () => {
    captureLogs();
    const app = await createApp();
    const res = await request(app)
      .post("/ingest")
      .set("x-project-key", PROJECT_KEY)
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    expect(res.body).toEqual({
      error: expect.objectContaining({
        code: "HEAT_E_INVALID_JSON",
        status: 400,
        requestId: res.headers["x-request-id"]
      }),
      code: "invalid_json",
      message: res.body.error.message,
      requestId: res.headers["x-request-id"]
    });
  });

  it("rejects a non-JSON Content-Type with 415", async () => {
    captureLogs();
    const app = await createApp();
    const res = await request(app)
      .post("/ingest")
      .set("x-project-key", PROJECT_KEY)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ events: [] }))
      .expect(415);
    expect(res.body.error).toMatchObject({
      code: "HEAT_E_UNSUPPORTED_MEDIA_TYPE",
      cause: 'Content-Type is "text/plain", expected "application/json"'
    });
  });

  it("answers unknown collector routes with a JSON 404 and leaves host routes alone", async () => {
    captureLogs();
    const app = await createApp();
    app.get("/host-page", (_req, res) => res.send("host"));

    const res = await request(app).get("/api/nope?x=1").expect(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error).toMatchObject({ code: "HEAT_E_ROUTE_NOT_FOUND", cause: "no route for GET /api/nope" });
    await request(app).get("/ingest").expect(404);
    await request(app).get("/host-page").expect(200, "host");
  });

  it("logs code and cause without stacks, and keeps the JWKS URL server-side", async () => {
    const logs = captureLogs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    const jwksUrl = "https://idp.internal.example/jwks";
    const app = await createApp({ auth: { mode: "jwt", jwksUrl, issuer: "i", audience: "a" } });
    const res = await request(app)
      .post("/ingest")
      .set("x-project-key", PROJECT_KEY)
      .set("authorization", `Bearer ${JWT}`)
      .send({})
      .expect(503);

    expect(JSON.stringify(res.body)).not.toContain(jwksUrl);
    const line = logs.find((l) => l.includes("HEAT_E_AUTH_JWKS_UNAVAILABLE"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string);
    expect(parsed.err).toEqual({ code: "HEAT_E_AUTH_JWKS_UNAVAILABLE", cause: "JWKS returned HTTP 503", jwksUrl });
    expect(logs.join("\n")).not.toMatch(/"stack"|\n\s+at /);
  });

  it("sends Deprecation/Link only with responses that carry legacy fields", async () => {
    captureLogs();
    const app = await createApp();
    const ok = await request(app).get("/api/metrics").expect(200);
    expect(ok.headers.deprecation).toBeUndefined();
    expect(ok.headers.link).toBeUndefined();
    const bad = await request(app).get("/api/projects/p/heatmap").query({ resolution: 1 }).expect(400);
    expect(bad.body.code).toBe("invalid_query");
    expect(bad.headers.deprecation).toBe("true");
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
      .expect(503);
    expect(jwt.headers["retry-after"]).toBe("30");
    expect(jwt.body.error).toMatchObject({
      code: "HEAT_E_AUTH_JWKS_UNAVAILABLE",
      status: 503,
      cause: expect.stringContaining("HTTP 503")
    });
    expect(jwt.body.code).toBe("jwks_unavailable");

    const everything = [...logs, JSON.stringify(rate.body), JSON.stringify(jwt.body)].join("\n");
    expect(everything).toContain("pk_…a1b2");
    expect(everything).toContain("203.0.113.0");
    expect(everything).not.toContain(PROJECT_KEY);
    expect(everything).not.toContain("203.0.113.77");
    expect(everything).not.toContain(JWT);
    expect(everything).not.toContain(JWT.split(".")[2]);
  });
});
