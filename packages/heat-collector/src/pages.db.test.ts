import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createCollector } from "./collector";
import type { DbAdapterConfig } from "./db";

// Same projects/pages results on every database (#25). Postgres, MySQL and MongoDB run when
// HEAT_TEST_PG_URL / HEAT_TEST_MYSQL_URL / HEAT_TEST_MONGO_URL are set (`test:golden`, one file at a time:
// the golden test drops the same tables).
const TABLES = "events, sessions, users, projects, heatmap_rollup, pages";
const closers: Array<() => Promise<void>> = [];
const targets: Array<{ name: string; db: () => Promise<DbAdapterConfig> }> = [
  {
    name: "sqlite",
    db: async () => ({
      dialect: "sqlite",
      client: new Database(path.join(mkdtempSync(path.join(tmpdir(), "heat-pages-db-")), "p.db"))
    })
  }
];
if (process.env.HEAT_TEST_PG_URL) {
  targets.push({
    name: "pg",
    db: async () => {
      const { Pool } = await import("pg");
      const client = new Pool({ connectionString: process.env.HEAT_TEST_PG_URL });
      await client.query(`DROP TABLE IF EXISTS ${TABLES}`);
      closers.push(() => client.end());
      return { dialect: "pg", client };
    }
  });
}
if (process.env.HEAT_TEST_MYSQL_URL) {
  targets.push({
    name: "mysql",
    db: async () => {
      const mysql = await import("mysql2/promise");
      const client = mysql.createPool(process.env.HEAT_TEST_MYSQL_URL || "");
      await client.query(`DROP TABLE IF EXISTS ${TABLES}`);
      closers.push(() => client.end());
      return { dialect: "mysql", client };
    }
  });
}
if (process.env.HEAT_TEST_MONGO_URL) {
  targets.push({
    name: "mongodb",
    db: async () => {
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(process.env.HEAT_TEST_MONGO_URL || "");
      await client.connect();
      const db = client.db(`heat_pages_${process.pid}`);
      await db.dropDatabase();
      closers.push(() => client.close());
      return { dialect: "mongodb", db };
    }
  });
}
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

const event = (sessionId: string, i: number, type: string, eventPath: string, ts: number, title?: string) => ({
  eventId: `${sessionId}-${i}`,
  sessionId,
  ts,
  path: eventPath,
  viewport: { w: 1200, h: 800, dpr: 1 },
  device: { ua: "t", platform: "t", language: "en" },
  ...(type === "pageview" ? { type, to: eventPath, ...(title ? { title } : {}) } : { type, x: 1, y: 2 })
});

describe.each(targets)("projects and pages on $name", ({ db }) => {
  it("counts pageview sessions and clicks, keeps the latest title and pages with a cursor", async () => {
    const collector = await createCollector({
      db: await db(),
      auth: { mode: "projectKey" },
      heatmap: { rollupCatchUpIntervalMs: 0 }
    });
    const app = express().use(collector.router);
    const now = Date.now();
    const ingest = (sessionId: string, events: Array<[string, string, number, string?]>) =>
      request(app)
        .post("/ingest")
        .set("x-project-key", "db-key")
        .send({
          session: { id: sessionId, startedAt: now, lastSeenAt: now },
          events: events.map(([type, p, ts, title], i) => event(sessionId, i, type, p, ts, title))
        })
        .expect(200);

    await ingest("s1", [
      ["pageview", "/b?token=x", now - 3000, "Old B"],
      ["click", "/b", now - 2500],
      ["pageview", "/b", now - 1000, "B"]
    ]);
    await ingest("s2", [
      ["pageview", "/b", now - 9000, "Stale B"],
      ["pageview", "/a", now - 500]
    ]);
    await ingest("s3", [["click", "/a", now - 100]]);

    const projects = await request(app).get("/api/projects").expect(200);
    expect(projects.body.projects).toHaveLength(1);
    expect(projects.body.projects[0]).toMatchObject({ name: "Default", eventsLast24h: 6, receivingData: true });
    const id = projects.body.projects[0].id;

    const first = await request(app).get(`/api/projects/${id}/pages`).query({ limit: 1 }).expect(200);
    expect(first.body.pages).toEqual([{ path: "/b", title: "B", hasTitle: true, sessions: 2, clicks: 1 }]);
    const second = await request(app)
      .get(`/api/projects/${id}/pages`)
      .query({ limit: 1, cursor: first.body.meta.nextCursor })
      .expect(200);
    expect(second.body.pages).toEqual([{ path: "/a", title: "/a", hasTitle: false, sessions: 1, clicks: 1 }]);
    expect(second.body.meta.nextCursor).toBeNull();
    collector.close();
  });
});
