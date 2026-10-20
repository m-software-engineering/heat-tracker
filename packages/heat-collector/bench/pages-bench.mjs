// Popular-pages budget bench (issue #25): 10 k distinct pages / 1 M events, GET /api/projects/:id/pages.
// Gate: p95 <= 200 ms on Postgres. MySQL, SQLite and MongoDB are measured and reported (never fail);
// a result over 2x the budget is flagged so an issue can be opened. Needs a built package:
//   BENCH_DIALECT=pg DATABASE_URL=postgres://... node bench/pages-bench.mjs   (tables are dropped)
//   BENCH_DIALECT=mysql|mongodb DATABASE_URL=... · BENCH_DIALECT=sqlite (temp file)
import express from "express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCollector } from "../dist/index.js";

const EVENTS = Number(process.env.BENCH_EVENTS || 1_000_000);
const PAGES = Number(process.env.BENCH_PAGES || 10_000);
const REQUESTS = Number(process.env.BENCH_REQUESTS || 200);
const P95_BUDGET_MS = 200;
const dialect = process.env.BENCH_DIALECT || "pg";
const url = process.env.DATABASE_URL;
const gated = dialect === "pg";
const PROJECT_ID = "bench-project";
const TABLES = ["events", "sessions", "users", "projects", "heatmap_rollup", "pages"];
if (dialect !== "sqlite" && !url) {
  console.error(`pages bench: set DATABASE_URL for BENCH_DIALECT=${dialect} (tables are dropped)`);
  process.exit(2);
}

// Each session (20 events) stays on one page; 5% pageviews, 15% clicks, 80% moves, over the last 7 days.
const now = Date.now();
const eventAt = (g) => {
  const type = g % 20 === 0 ? "pageview" : g % 20 < 4 ? "click" : "move";
  const session = Math.floor(g / 20);
  return [`e${g}`, PROJECT_ID, `s${session}`, type, now - ((g * 600) % (7 * 86_400_000)), `/page/${session % PAGES}`];
};

const open = async () => {
  if (dialect === "pg") {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url });
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")}`);
    return {
      config: { dialect, client: pool },
      run: (q, p) => pool.query(q, p),
      ph: (i) => `$${i}`,
      close: () => pool.end()
    };
  }
  if (dialect === "mysql") {
    const mysql = await import("mysql2/promise");
    const pool = mysql.createPool(url);
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")}`);
    return {
      config: { dialect, client: pool },
      run: (q, p) => pool.query(q, p),
      ph: () => "?",
      close: () => pool.end()
    };
  }
  if (dialect === "sqlite") {
    const { default: Database } = await import("better-sqlite3");
    const client = new Database(path.join(mkdtempSync(path.join(tmpdir(), "heat-pages-bench-")), "b.db"));
    return {
      config: { dialect, client },
      run: async (q, p) => client.prepare(q).run(...(p ?? [])),
      ph: () => "?",
      close: async () => client.close()
    };
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db("heat_pages_bench");
  await db.dropDatabase();
  return { config: { dialect: "mongodb", db }, db, close: () => client.close() };
};

const store = await open();
const collector = await createCollector({
  db: store.config,
  auth: { mode: "projectKey" },
  logging: { level: "error" },
  heatmap: { rollupCatchUpIntervalMs: 0 }
});

const seedStart = Date.now();
const BATCH = dialect === "sqlite" ? 2000 : 5000;
if (store.db) {
  await store.db.collection("projects").insertOne({ id: PROJECT_ID, key: "bench", name: "Bench", createdAt: now });
  for (let start = 0; start < EVENTS; start += BATCH) {
    const docs = [];
    for (let g = start; g < Math.min(EVENTS, start + BATCH); g += 1) {
      const [id, projectId, sessionId, type, ts, p] = eventAt(g);
      docs.push({ id, projectId, sessionId, type, ts, path: p, ...(type === "pageview" ? {} : { x: 1, y: 2 }) });
    }
    await store.db.collection("events").insertMany(docs, { ordered: false });
  }
  const pages = Array.from({ length: PAGES }, (_, i) => ({
    projectId: PROJECT_ID,
    path: `/page/${i}`,
    title: `Page ${i}`,
    titleTs: now
  }));
  await store.db.collection("pages").insertMany(pages);
} else {
  if (dialect === "sqlite") await store.run("BEGIN");
  await store.run(
    `INSERT INTO projects (id, ${dialect === "mysql" ? "`key`" : "key"}, name, created_at) VALUES ('${PROJECT_ID}', 'bench', 'Bench', ${now})`
  );
  for (let start = 0; start < EVENTS; start += BATCH) {
    const params = [];
    const rows = [];
    for (let g = start; g < Math.min(EVENTS, start + BATCH); g += 1) {
      const base = params.length;
      params.push(...eventAt(g));
      rows.push(`(${[1, 2, 3, 4, 5, 6].map((i) => store.ph(base + i)).join(", ")}, 1)`);
    }
    await store.run(
      `INSERT INTO events (id, project_id, session_id, type, ts, path, rollup_state) VALUES ${rows.join(", ")}`,
      params
    );
  }
  for (let start = 0; start < PAGES; start += BATCH) {
    const params = [];
    const rows = [];
    for (let i = start; i < Math.min(PAGES, start + BATCH); i += 1) {
      const base = params.length;
      params.push(PROJECT_ID, `/page/${i}`, `Page ${i}`, now);
      rows.push(`(${[1, 2, 3, 4].map((j) => store.ph(base + j)).join(", ")})`);
    }
    await store.run(`INSERT INTO pages (project_id, path, title, title_ts) VALUES ${rows.join(", ")}`, params);
  }
  if (dialect === "sqlite") await store.run("COMMIT");
  await store.run(dialect === "mysql" ? "ANALYZE TABLE events, pages" : "ANALYZE");
}
console.log(`seeded ${EVENTS} events / ${PAGES} pages on ${dialect} in ${Date.now() - seedStart} ms`);

const app = express().use(collector.router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const target = `http://127.0.0.1:${server.address().port}/api/projects/${PROJECT_ID}/pages`;
const first = await (await fetch(target)).json();
if (first.pages?.length !== 50 || first.pages[0].sessions < 1)
  throw new Error(`unexpected first page: ${JSON.stringify(first).slice(0, 300)}`);

const latencies = [];
let cursor = null;
for (let i = 0; i < REQUESTS; i += 1) {
  // Alternate first page and the next page (cursor), as a user scrolling the list does.
  const started = performance.now();
  const res = await fetch(i % 2 && cursor ? `${target}?cursor=${cursor}` : target);
  const body = await res.json();
  latencies.push(performance.now() - started);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  if (!(i % 2)) cursor = body.meta.nextCursor;
}
server.close();
collector.close();
await store.close();

latencies.sort((a, b) => a - b);
const at = (q) => Number(latencies[Math.min(latencies.length - 1, Math.ceil(q * latencies.length) - 1)].toFixed(1));
const summary = {
  dialect,
  events: EVENTS,
  pages: PAGES,
  requests: REQUESTS,
  latencyMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99) }
};
console.log(JSON.stringify(summary, null, 2));
const p95 = summary.latencyMs.p95;
if (p95 > P95_BUDGET_MS) {
  const over2x = p95 > 2 * P95_BUDGET_MS ? " (over 2x: open an issue)" : "";
  if (gated) {
    console.error(`pages bench FAILED: p95 ${p95} ms over ${P95_BUDGET_MS} ms${over2x}`);
    process.exit(1);
  }
  console.warn(`pages bench (${dialect}, report only): p95 ${p95} ms over ${P95_BUDGET_MS} ms${over2x}`);
} else {
  console.log(`pages bench passed on ${dialect}: p95 ${p95} ms <= ${P95_BUDGET_MS} ms`);
}
