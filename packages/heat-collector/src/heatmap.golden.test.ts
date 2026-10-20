import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createCollector } from "./collector";
import type { DbAdapterConfig } from "./db";
import { goldenPayloads, goldenQueries } from "./__fixtures__/heatmap-fixture";

// One recording for every database: events without a position are skipped everywhere (#26).
// Points were first recorded from the pre-#26 in-Node aggregation; only the no-position rows differ.
const GOLDEN_FILE = path.join(__dirname, "__fixtures__", "heatmap-golden.json");
const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as Record<string, Record<string, unknown>>;
const record = process.env.HEAT_GOLDEN_RECORD;

type Target = { name: string; db: () => Promise<DbAdapterConfig> };
const KEY = "golden-key";

const openMongo = async (url: string) => {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(`heat_golden_${process.pid}`);
  await db.dropDatabase();
  return { client, db };
};

const targets: Target[] = [
  {
    name: "sqlite",
    db: async () => {
      const client = new Database(path.join(mkdtempSync(path.join(tmpdir(), "heat-golden-")), "g.db"));
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
      await client.query("DROP TABLE IF EXISTS events, sessions, users, projects, heatmap_rollup");
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
      await client.query("DROP TABLE IF EXISTS events, sessions, users, projects, heatmap_rollup");
      return { dialect: "mysql", client };
    }
  });
}

const mongoClients: Array<{ close: () => Promise<void> }> = [];
if (process.env.HEAT_TEST_MONGO_URL) {
  targets.push({
    name: "mongodb",
    db: async () => {
      const { client, db } = await openMongo(process.env.HEAT_TEST_MONGO_URL || "");
      mongoClients.push(client);
      return { dialect: "mongodb", db };
    }
  });
}

afterAll(async () => {
  await Promise.all(mongoClients.map((client) => client.close()));
});

// totalEvents/sampled were added by #26; the rest of the body must equal the recording.
const comparable = (body: any) => {
  if (!record) {
    expect(body.meta.totalEvents).toBe(body.meta.total);
    expect(body.meta.sampled).toBe(false);
  }
  const meta = { ...body.meta };
  delete meta.totalEvents;
  delete meta.sampled;
  // Points are stored as "x,y,value" to keep the recording compact.
  const points = [...body.points].sort((a: any, b: any) => a.y - b.y || a.x - b.x);
  return { ...body, meta, points: points.map((p: any) => `${p.x},${p.y},${p.value}`) };
};

describe.each(targets)("heatmap golden ($name)", (target) => {
  it("matches the recorded in-Node aggregation for every fixture query", async () => {
    const config = await target.db();
    const collector = await createCollector({ db: config, auth: { mode: "projectKey" } });
    const app = express();
    app.use(collector.router);

    for (const payload of goldenPayloads()) {
      await request(app).post("/ingest").set("x-project-key", KEY).send(payload).expect(200);
    }
    const projectId = await findProjectId(config);
    const results: Record<string, unknown> = {};
    for (const [name, query] of Object.entries(goldenQueries)) {
      const res = await request(app).get(`/api/projects/${projectId}/heatmap`).query(query).expect(200);
      results[name] = comparable(res.body);
    }

    if (record) {
      golden.all = results;
      writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
    }
    expect(results).toEqual(golden.all);
  }, 60_000);
});

const findProjectId = async (config: any): Promise<string> => {
  if (config.dialect === "mongodb") return (await config.db.collection("projects").findOne({ key: KEY })).id;
  if (config.dialect === "sqlite") return config.client.prepare("select id from projects where key = ?").get(KEY).id;
  if (config.dialect === "pg")
    return (await config.client.query("select id from projects where key = $1", [KEY])).rows[0].id;
  const [rows] = await config.client.query("select id from projects where `key` = ?", [KEY]);
  return rows[0].id;
};
