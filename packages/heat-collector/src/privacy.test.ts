import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "./collector";
import { sanitizePath } from "./path-privacy";
import { isEmailLike, isSensitiveParamName, normalizeParamName } from "./privacy-rules";

const cases = JSON.parse(readFileSync(path.join(__dirname, "../../../fixtures/privacy-cases.json"), "utf8")) as {
  params: { drop: string[]; keep: string[] };
  emails: { mask: string[]; keep: string[] };
  paths: Array<[string, string]>;
};

const setup = async () => {
  const client = new Database(path.join(mkdtempSync(path.join(tmpdir(), "heat-privacy-")), "test.db"));
  const collector = await createCollector({
    db: { dialect: "sqlite", client },
    auth: { mode: "projectKey" },
    heatmap: { rollupCatchUpIntervalMs: 0 }
  });
  const app = express();
  app.use(collector.router);
  return { app, client };
};

const ingest = (app: express.Express, key: string, paths: string[], ts = Date.now()) =>
  request(app)
    .post("/ingest")
    .set("x-project-key", key)
    .send({
      session: { id: `s-${key}`, startedAt: ts, lastSeenAt: ts },
      events: paths.map((p, i) => ({
        eventId: `${key}-${ts}-${i}`,
        sessionId: `s-${key}`,
        ts,
        path: p,
        type: "pageview",
        to: p,
        viewport: { w: 1200, h: 800, dpr: 1 },
        device: { ua: "t", platform: "t", language: "en" }
      }))
    });

describe("shared privacy rules (fixtures/privacy-cases.json)", () => {
  it("is the same file as the SDK's copy", () => {
    const here = readFileSync(path.join(__dirname, "privacy-rules.ts"), "utf8");
    expect(readFileSync(path.join(__dirname, "../../heat-sdk/src/privacy-rules.ts"), "utf8")).toBe(here);
  });

  it("normalizes names like the SDK's allowlist does", () => {
    expect(normalizeParamName("%EF%BC%B4OKEN")).toBe("token");
  });

  it.each(cases.params.drop)("drops the param %s", (name) => {
    expect(isSensitiveParamName(name)).toBe(true);
    expect(sanitizePath(`/p?${name}=v&page=2`)).toBe("/p?page=2");
  });

  it.each(cases.params.keep)("keeps the param %s", (name) => {
    expect(sanitizePath(`/p?${name}=v`)).toBe(`/p?${name}=v`);
  });

  it.each(cases.emails.mask)("treats %s as an email (value and segment)", (email) => {
    expect(isEmailLike(email)).toBe(true);
    expect(sanitizePath(`/u/${email}?ref=${encodeURIComponent(email)}&page=2`)).toBe("/u/[email]?page=2");
  });

  it.each(cases.emails.keep)("does not treat %s as an email", (text) => {
    expect(isEmailLike(text)).toBe(false);
    expect(sanitizePath(`/u/${text}?ref=${text}`)).toBe(`/u/${text}?ref=${text}`);
  });

  it.each(cases.paths)("stores %s as %s", (input, output) => {
    expect(sanitizePath(input)).toBe(output);
  });

  it("drops an undecodable param name and NFKC-folds full-width names on ingest", async () => {
    const { app, client } = await setup();
    await ingest(app, "k1", ["/p;jsessionid=ABC?%74oken%ZZ=SECRET&ｔｏｋｅｎ=X&page=2"]).expect(200);
    expect(client.prepare("select distinct path from events").all()).toEqual([{ path: "/p?page=2" }]);
  });
});

describe("project key validation (#64 QA)", () => {
  it("rejects a key outside [A-Za-z0-9_-]{1,128} with HEAT_E_PROJECT_KEY_INVALID and creates no project", async () => {
    const { app, client } = await setup();
    for (const key of ['x"});fetch("//evil")//', "a</script>", "k".repeat(129), "a.b c"]) {
      const res = await ingest(app, key, ["/"]).expect(400);
      expect(res.body.error).toMatchObject({ code: "HEAT_E_PROJECT_KEY_INVALID" });
      expect(res.body.error.fix).toMatch(/A-Z/);
    }
    expect(client.prepare("select count(*) as n from projects").get()).toEqual({ n: 0 });
    await ingest(app, `pk_${"a".repeat(125)}`, ["/"]).expect(200);
  });
});

describe("GET /api/projects snapshot and limits (#64 QA)", () => {
  it("keeps the order across pages while events and projects arrive between them", async () => {
    const { app } = await setup();
    const now = Date.now();
    for (const [i, key] of ["p1", "p2", "p3"].entries())
      await ingest(app, key, ["/"], now - (i + 1) * 1000).expect(200);
    const first = await request(app).get("/api/projects").query({ limit: 2 }).expect(200);
    expect(first.body.projects.map((p: any) => p.projectKey)).toEqual(["p1", "p2"]);
    // p3 gets a newer event and a new project appears: neither moves into the next page.
    await ingest(app, "p3", ["/"], Date.now() + 10).expect(200);
    await ingest(app, "p4", ["/"]).expect(200);
    const second = await request(app).get("/api/projects").query({ cursor: first.body.meta.nextCursor }).expect(200);
    expect(second.body.projects.map((p: any) => p.projectKey)).toEqual(["p3"]);
    expect(second.body.meta.nextCursor).toBeNull();
  });

  it("uses the default for an empty limit and leaves future-dated events out of eventsLast24h", async () => {
    const { app } = await setup();
    await ingest(app, "future", ["/"], Date.now() + 3_600_000).expect(200);
    const res = await request(app).get("/api/projects?limit=").expect(200);
    expect(res.body.meta.limit).toBe(50);
    expect(res.body.projects).toEqual([
      expect.objectContaining({ projectKey: "future", eventsLast24h: 0, receivingData: false })
    ]);
  });
});
