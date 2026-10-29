import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { createCollector } from "./collector";
import type { DbAdapterConfig } from "./db";

const KEY = "dedupe-key";
const T0 = Date.UTC(2025, 9, 9, 8);
const TABLES = "events, sessions, users, projects, heatmap_rollup, pages";
const collectors: Array<{ close: () => void }> = [];
const closers: Array<() => Promise<void>> = [];

// SQL targets drop shared tables, so test:golden runs one file at a time.
const targets: Array<{ name: string; db: () => Promise<DbAdapterConfig> }> = [
  {
    name: "sqlite",
    db: async () => {
      const client = new Database(":memory:");
      closers.push(async () => {
        client.close();
      });
      return { dialect: "sqlite", client };
    }
  }
];

if (process.env.HEAT_TEST_PG_URL) {
  targets.push({
    name: "pg",
    db: async () => {
      const { Pool } = await import("pg");
      const client = new Pool({ connectionString: process.env.HEAT_TEST_PG_URL });
      closers.push(() => client.end());
      await client.query(`DROP TABLE IF EXISTS ${TABLES}`);
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
      closers.push(() => client.end());
      await client.query(`DROP TABLE IF EXISTS ${TABLES}`);
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
      closers.push(() => client.close());
      await client.connect();
      const db = client.db(`heat_dedupe_${process.pid}`);
      await db.dropDatabase();
      return { dialect: "mongodb", db };
    }
  });
}

afterAll(async () => {
  for (const collector of collectors) collector.close();
  await Promise.all(closers.map((close) => close()));
});

const click = (i: number) => ({
  eventId: `dedupe-click-${i}`,
  sessionId: "dedupe-session",
  ts: T0 + i,
  path: "/dedupe",
  viewport: { w: 1440, h: 900 },
  device: {},
  type: "click",
  x: i * 10,
  y: 20
});

const findProjectId = async (config: DbAdapterConfig): Promise<string> => {
  if (config.dialect === "mongodb") return (await config.db.collection("projects").findOne({ key: KEY })).id;
  if (config.dialect === "sqlite") return config.client.prepare("select id from projects where key = ?").get(KEY).id;
  if (config.dialect === "pg")
    return (await config.client.query("select id from projects where key = $1", [KEY])).rows[0].id;
  const [rows] = await config.client.query("select id from projects where `key` = ?", [KEY]);
  return rows[0].id;
};

const sqlCount = async (config: DbAdapterConfig, query: string): Promise<number> => {
  if (config.dialect === "sqlite") return Number(config.client.prepare(query).get().n);
  if (config.dialect === "pg") return Number((await config.client.query(query)).rows[0].n);
  const [rows] = await config.client.query(query);
  return Number(rows[0].n);
};

describe.each(targets)("ingest dedupe golden ($name)", (target) => {
  it.each([
    { name: "identical", eventIds: [1, 2, 3], newEventIds: [], expected: 3 },
    { name: "partially overlapping", eventIds: [2, 4, 3, 5], newEventIds: [4, 5], expected: 5 }
  ])(
    "counts only unique clicks after a $name batch",
    async ({ eventIds, newEventIds, expected }) => {
      const config = await target.db();
      const collector = await createCollector({
        db: config,
        auth: { mode: "projectKey" },
        // Disable only the catch-up timer; ingest-time rollup writes must still run.
        heatmap: { rollupCatchUpIntervalMs: 0 }
      });
      collectors.push(collector);
      const app = express().use(collector.router);
      const batch = (ids: number[]) => ({
        session: { id: "dedupe-session", startedAt: T0, lastSeenAt: T0 + 5 },
        events: ids.map(click)
      });
      const ingest = (payload: ReturnType<typeof batch>) =>
        request(app).post("/ingest").set("x-project-key", KEY).send(payload).expect(200);

      await ingest(batch([1, 2, 3]));
      const projectId = await findProjectId(config);
      const assertCounts = async (count: number) => {
        if (config.dialect === "mongodb") {
          expect(await config.db.collection("events").countDocuments()).toBe(count);
        } else {
          expect(await sqlCount(config, "select count(*) as n from events")).toBe(count);
          expect(await sqlCount(config, "select coalesce(sum(cnt), 0) as n from heatmap_rollup")).toBe(count);
        }
        const res = await request(app)
          .get(`/api/projects/${projectId}/heatmap`)
          // A whole hour reads the SQL rollup, rather than only raw edge-hour events.
          .query({ path: "/dedupe", type: "click", from: String(T0), to: String(T0 + 3_600_000) })
          .expect(200);
        expect(res.body.meta.total).toBe(count);
        expect(res.body.meta.plotted).toBe(count);
      };

      await assertCounts(3);
      const rollupBefore =
        config.dialect === "mongodb"
          ? null
          : await sqlCount(config, "select coalesce(sum(cnt), 0) as n from heatmap_rollup");
      // Stable ids and fields make the identical case resend exactly the original payload.
      // The partial batch has new ids {4, 5} (2 rows) and duplicate ids {2, 3}.
      await ingest(batch(eventIds));
      await assertCounts(expected);
      if (rollupBefore !== null) {
        const rollupAfter = await sqlCount(config, "select coalesce(sum(cnt), 0) as n from heatmap_rollup");
        expect(rollupAfter - rollupBefore).toBe(newEventIds.length);
      }
    },
    60_000
  );
});
