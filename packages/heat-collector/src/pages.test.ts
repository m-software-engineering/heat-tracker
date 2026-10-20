import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "./collector";

const KEY = "pages-key";

const setup = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-pages-"));
  const client = new Database(path.join(dir, "test.db"));
  const collector = await createCollector({
    db: { dialect: "sqlite", client },
    auth: { mode: "projectKey" },
    heatmap: { rollupCatchUpIntervalMs: 0 }
  });
  const app = express();
  app.use(collector.router);
  // Counts statements prepared while a request runs (drizzle prepares one per query).
  let prepared = 0;
  const prepare = client.prepare.bind(client);
  client.prepare = ((source: string) => {
    prepared += 1;
    return prepare(source);
  }) as typeof client.prepare;
  const countQueries = async <T>(work: () => Promise<T>) => {
    prepared = 0;
    const result = await work();
    return { result, queries: prepared };
  };
  return { app, client, countQueries };
};

type Ev = { type: "pageview" | "click"; path: string; ts?: number; title?: string };

const send = (app: express.Express, sessionId: string, events: Ev[], key = KEY) => {
  const now = Date.now();
  return request(app)
    .post("/ingest")
    .set("x-project-key", key)
    .send({
      session: { id: sessionId, startedAt: now, lastSeenAt: now },
      events: events.map((e, i) => ({
        eventId: `${sessionId}-${i}`,
        sessionId,
        ts: e.ts ?? now,
        path: e.path,
        viewport: { w: 1200, h: 800, dpr: 1 },
        device: { ua: "t", platform: "t", language: "en" },
        ...(e.type === "pageview" ? { type: "pageview", to: e.path, title: e.title } : { type: "click", x: 1, y: 2 })
      }))
    })
    .expect(200);
};

const projectIdOf = (client: Database.Database, key = KEY) =>
  (client.prepare("select id from projects where key = ?").get(key) as { id: string }).id;

describe("GET /api/projects/:projectId/pages", () => {
  it("lists pages by distinct pageview sessions with clicks and the latest-seen title", async () => {
    const { app, client } = await setup();
    const now = Date.now();
    await send(app, "s1", [
      { type: "pageview", path: "/pricing", title: "  Pricing   plans ", ts: now - 2000 },
      { type: "click", path: "/pricing" },
      { type: "click", path: "/pricing" },
      { type: "pageview", path: "/pricing", title: "Pricing", ts: now - 1000 }
    ]);
    await send(app, "s2", [{ type: "pageview", path: "/pricing", title: "Pricing — new", ts: now }]);
    // An older pageview arriving later does not overwrite the newer title.
    await send(app, "s3", [{ type: "pageview", path: "/pricing", title: "Stale", ts: now - 5000 }]);
    await send(app, "s4", [{ type: "pageview", path: "/docs" }]);
    // Clicks without a pageview on that path do not make a session.
    await send(app, "s5", [
      { type: "click", path: "/docs" },
      { type: "click", path: "/orphan" }
    ]);

    const res = await request(app)
      .get(`/api/projects/${projectIdOf(client)}/pages`)
      .expect(200);
    expect(res.body.pages).toEqual([
      { path: "/pricing", title: "Pricing — new", hasTitle: true, sessions: 3, clicks: 2 },
      { path: "/docs", title: "/docs", hasTitle: false, sessions: 1, clicks: 1 }
    ]);
    expect(res.body.meta).toMatchObject({ count: 2, limit: 50, nextCursor: null });
    expect(res.body.meta.range.to - res.body.meta.range.from).toBe(7 * 86_400_000);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("defaults to the last 7 days and honours from/to", async () => {
    const { app, client } = await setup();
    const old = Date.now() - 8 * 86_400_000;
    await send(app, "old", [{ type: "pageview", path: "/old", ts: old }]);
    await send(app, "new", [{ type: "pageview", path: "/new" }]);
    const id = projectIdOf(client);
    const recent = await request(app).get(`/api/projects/${id}/pages`).expect(200);
    expect(recent.body.pages.map((p: any) => p.path)).toEqual(["/new"]);
    const ranged = await request(app)
      .get(`/api/projects/${id}/pages`)
      .query({ from: old - 1, to: old + 1 })
      .expect(200);
    expect(ranged.body.pages.map((p: any) => p.path)).toEqual(["/old"]);
  });

  it("pages with a cursor, clamps limit to 200 and runs at most 2 queries", async () => {
    const { app, client, countQueries } = await setup();
    const events: Ev[] = Array.from({ length: 205 }, (_, i) => ({
      type: "pageview",
      path: `/p/${String(i).padStart(3, "0")}`
    }));
    await send(app, "many", events);
    await send(app, "again", [{ type: "pageview", path: "/p/100" }]);
    const id = projectIdOf(client);

    const { result: first, queries } = await countQueries(() =>
      request(app).get(`/api/projects/${id}/pages`).query({ limit: 500 }).expect(200)
    );
    expect(queries).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(2);
    expect(first.body.meta.limit).toBe(200);
    expect(first.body.pages).toHaveLength(200);
    expect(first.body.pages[0]).toMatchObject({ path: "/p/100", sessions: 2 });
    expect(first.body.pages[1].path).toBe("/p/000");

    const { result: second, queries: q2 } = await countQueries(() =>
      request(app)
        .get(`/api/projects/${id}/pages`)
        .query({ limit: 500, cursor: first.body.meta.nextCursor })
        .expect(200)
    );
    expect(q2).toBeLessThanOrEqual(2);
    expect(second.body.pages.map((p: any) => p.path)).toEqual(["/p/200", "/p/201", "/p/202", "/p/203", "/p/204"]);
    expect(second.body.meta.nextCursor).toBeNull();
  });

  it("answers HEAT_E_PROJECT_NOT_FOUND and HEAT_E_QUERY_CURSOR with a fix", async () => {
    const { app, client } = await setup();
    const missing = await request(app).get("/api/projects/nope/pages").expect(404);
    expect(missing.body.error).toMatchObject({
      code: "HEAT_E_PROJECT_NOT_FOUND",
      cause: 'projectId="nope"',
      fix: "List projects with GET /api/projects and use one of the returned ids."
    });
    await send(app, "s", [{ type: "pageview", path: "/" }]);
    const bad = await request(app)
      .get(`/api/projects/${projectIdOf(client)}/pages`)
      .query({ cursor: "zzz" })
      .expect(400);
    expect(bad.body.error.code).toBe("HEAT_E_QUERY_CURSOR");
    const projects = await request(app).get("/api/projects").query({ cursor: "e30" }).expect(400);
    expect(projects.body.error.code).toBe("HEAT_E_QUERY_CURSOR");
  });
});

describe("ingest path and title privacy", () => {
  it("strips params whose folded name contains a sensitive part, and email values; trims titles", async () => {
    const { app, client } = await setup();
    const dirty =
      "/a?utm_source=x&access_token=t&api_key=k&X-Amz-Signature=s&passwd=p&client_secret=c&Authorization=a" +
      "&jwt=j&my_session=9&promo-code=1&q=me%40x.com&email=plain&page=2#access=1&state_code=2";
    await send(app, "s", [
      { type: "pageview", path: dirty, title: `${"é".repeat(250)}` },
      { type: "click", path: dirty }
    ]);
    const paths = client.prepare("select distinct path from events").all() as Array<{ path: string }>;
    expect(paths).toEqual([{ path: "/a?utm_source=x&email=plain&page=2#access=1" }]);
    const page = client.prepare("select title from pages").get() as { title: string };
    expect(Array.from(page.title)).toHaveLength(200);
  });

  it("groups email-looking path segments as [email]", async () => {
    const { app, client } = await setup();
    await send(app, "a", [{ type: "pageview", path: "/users/ana@x.com/orders", title: "Orders" }]);
    await send(app, "b", [{ type: "pageview", path: "/users/bo%40y.org/orders" }]);
    const res = await request(app)
      .get(`/api/projects/${projectIdOf(client)}/pages`)
      .expect(200);
    expect(res.body.pages).toEqual([
      { path: "/users/[email]/orders", title: "Orders", hasTitle: true, sessions: 2, clicks: 0 }
    ]);
  });
});

describe("GET /api/projects", () => {
  it("lists projects with no events first, then by most recent event, with projectKey and a cursor", async () => {
    const { app, client, countQueries } = await setup();
    const now = Date.now();
    await send(app, "old", [{ type: "pageview", path: "/", ts: now - 2 * 86_400_000 }], "key-old");
    await send(
      app,
      "new",
      [
        { type: "pageview", path: "/" },
        { type: "click", path: "/" }
      ],
      "key-new"
    );
    client
      .prepare("insert into projects (id, key, name, created_at) values ('empty', 'key-empty', 'Empty', ?)")
      .run(now);

    const { result: first, queries } = await countQueries(() =>
      request(app).get("/api/projects").query({ limit: 2 }).expect(200)
    );
    expect(queries).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(2);
    expect(first.body.projects).toEqual([
      expect.objectContaining({
        id: "empty",
        projectKey: "key-empty",
        eventsLast24h: 0,
        lastEventAt: null,
        receivingData: false
      }),
      expect.objectContaining({
        id: projectIdOf(client, "key-new"),
        projectKey: "key-new",
        name: "Default",
        eventsLast24h: 2,
        receivingData: true
      })
    ]);
    const second = await request(app).get("/api/projects").query({ cursor: first.body.meta.nextCursor }).expect(200);
    expect(second.body.projects).toEqual([
      expect.objectContaining({
        id: projectIdOf(client, "key-old"),
        projectKey: "key-old",
        eventsLast24h: 0,
        receivingData: false
      })
    ]);
    expect(second.body.meta).toMatchObject({ limit: 50, nextCursor: null });
  });
});

describe("admin token (#24) on the entry endpoints", () => {
  it("answers 401 without the token and lists with it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "heat-pages-admin-"));
    const collector = await createCollector({
      db: { dialect: "sqlite", file: path.join(dir, "t.db") },
      auth: { mode: "projectKey" },
      admin: { token: "admin-secret" },
      heatmap: { rollupCatchUpIntervalMs: 0 }
    });
    const app = express().use(collector.router);
    await send(app, "s", [{ type: "pageview", path: "/", title: "Home" }]);

    const denied = await request(app).get("/api/projects").expect(401);
    expect(denied.body.error.code).toBe("HEAT_E_ADMIN_TOKEN_MISSING");
    const list = await request(app).get("/api/projects").set("authorization", "Bearer admin-secret").expect(200);
    const id = list.body.projects[0].id;
    await request(app).get(`/api/projects/${id}/pages`).set("authorization", "Bearer wrong").expect(401);
    const pages = await request(app)
      .get(`/api/projects/${id}/pages`)
      .set("authorization", "Bearer admin-secret")
      .expect(200);
    expect(pages.body.pages).toEqual([{ path: "/", title: "Home", hasTitle: true, sessions: 1, clicks: 0 }]);
  });
});
