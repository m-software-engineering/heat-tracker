import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { createCollector } from "./collector";
import { createDb, type DbAdapterConfig } from "./db";
import { backfillRollup } from "./heatmap-migrate";

const KEY = "safety-key";
const T0 = 1_760_000_000_000;

type Target = {
  name: string;
  config: () => Promise<DbAdapterConfig>;
  query: (q: string, p?: unknown[]) => Promise<any[]>;
};

const sqliteTarget = (): Target => {
  const client = new Database(":memory:");
  return {
    name: "sqlite",
    config: async () => ({ dialect: "sqlite", client }),
    query: async (q, p = []) =>
      q.trim().startsWith("select") ? client.prepare(q).all(...p) : (client.prepare(q).run(...p), [])
  };
};

const pools: Array<{ end: () => Promise<void> }> = [];
const pgTarget = (): Target => {
  let pool: any;
  return {
    name: "pg",
    config: async () => {
      const { Pool } = await import("pg");
      // Own schema, so the golden test can use the same database at the same time.
      const admin = new Pool({ connectionString: process.env.HEAT_TEST_PG_URL });
      await admin.query("DROP SCHEMA IF EXISTS heat_safety CASCADE; CREATE SCHEMA heat_safety");
      await admin.end();
      pool = new Pool({ connectionString: process.env.HEAT_TEST_PG_URL, options: "-c search_path=heat_safety" });
      pools.push(pool);
      return { dialect: "pg", client: pool };
    },
    query: async (q, p = []) =>
      (
        await pool.query(
          q.replace(/\?/g, (_m: string, i: number) => `$${q.slice(0, i).split("?").length}`),
          p
        )
      ).rows
  };
};

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
});

const targets = [sqliteTarget, ...(process.env.HEAT_TEST_PG_URL ? [pgTarget] : [])];

const click = (i: number) => ({
  eventId: `c${i}`,
  sessionId: "s1",
  ts: T0 + i,
  path: "/",
  viewport: { w: 1440, h: 900 },
  device: {},
  type: "click",
  x: i % 50,
  y: 10
});

const setup = async (target: Target) => {
  const config = await target.config();
  const collector = await createCollector({ db: config, auth: { mode: "projectKey" }, logging: { level: "error" } });
  const app = express();
  app.use(collector.router);
  const ingest = (events: any[]) =>
    request(app)
      .post("/ingest")
      .set("x-project-key", KEY)
      .send({ session: { id: "s1", startedAt: T0, lastSeenAt: T0 }, events });
  return { app, config, ingest };
};

const totals = async (target: Target) => {
  const [events] = await target.query("select count(*) as n from events");
  const [rollup] = await target.query("select coalesce(sum(cnt), 0) as n from heatmap_rollup");
  return { events: Number(events.n), rollup: Number(rollup.n) };
};

describe.each(targets.map((make) => [make().name, make] as const))("rollup safety (%s)", (_name, make) => {
  it("rolls back the event insert when the rollup write fails", async () => {
    const target = make();
    const { ingest } = await setup(target);
    await ingest([click(1)]).expect(200);
    await target.query("drop table heatmap_rollup");

    const res = await ingest([click(2), click(3)]);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("HEAT_E_INGEST_FAILED");
    const [events] = await target.query("select count(*) as n from events");
    expect(Number(events.n)).toBe(1);
  });

  it("backfills old rows exactly once under concurrent ingest and re-runs as a no-op", async () => {
    const target = make();
    const { config, ingest } = await setup(target);
    await ingest([click(0)]).expect(200);
    // 12,000 rows from an older collector (3 backfill batches): no bucket, rollup_state NULL.
    const [{ id: projectId }] = await target.query("select id from projects");
    for (let start = 0; start < 12_000; start += 1000) {
      const values = Array.from(
        { length: 1000 },
        (_, k) =>
          `('old-${start + k}', '${projectId}', 's1', 'click', ${T0 + start + k}, '/', ${(start + k) % 50}, 10, '{}')`
      );
      await target.query(
        `insert into events (id, project_id, session_id, type, ts, path, x, y, meta_json) values ${values.join(",")}`
      );
    }

    // Two migrating collectors and live ingest at the same time.
    const ctxA = await createDb(config);
    const ctxB = await createDb(config);
    const live = Array.from({ length: 5 }, (_, i) => ingest([click(100 + i), click(200 + i)]).expect(200));
    const [a, b] = await Promise.all([backfillRollup(ctxA), backfillRollup(ctxB), ...live]);

    expect(Number(a) + Number(b)).toBe(12_000);
    expect(await totals(target)).toEqual({ events: 12_011, rollup: 12_011 });
    expect(await backfillRollup(ctxA)).toBe(0);
    expect(await totals(target)).toEqual({ events: 12_011, rollup: 12_011 });
    const [pending] = await target.query("select count(*) as n from events where rollup_state is null");
    expect(Number(pending.n)).toBe(0);
  }, 60_000);
});
