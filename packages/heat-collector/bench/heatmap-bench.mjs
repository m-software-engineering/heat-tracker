// Heatmap budget bench (issue #26, quality-bar §1): 1 M events on one page, GET /heatmap with
// autocannon, p95 <= 500 ms and collector RSS flat (± 20 MB). Needs a built package and Postgres:
//   DATABASE_URL=postgres://... node bench/heatmap-bench.mjs
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";

const EVENTS = Number(process.env.BENCH_EVENTS || 1_000_000);
const DURATION_S = Number(process.env.BENCH_DURATION_S || 20);
// One connection: the budget is the latency one dashboard user sees opening a heatmap.
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS || 1);
const P95_BUDGET_MS = 500;
const RSS_BUDGET_MB = 20;
const PROJECT_ID = "bench-project";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("heatmap bench: set DATABASE_URL to a Postgres database (tables are dropped)");
  process.exit(2);
}

const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("DROP TABLE IF EXISTS events, sessions, users, projects, heatmap_rollup");

const startCollector = async () => {
  const child = fork(fileURLToPath(new URL("./server.mjs", import.meta.url)), {
    env: { ...process.env, DATABASE_URL: url }
  });
  const port = await new Promise((resolve) => child.once("message", (m) => resolve(m.port)));
  return { child, port };
};

// First start creates the tables. Events are then seeded in SQL, the way an install that predates the
// rollup holds them, and the second start runs the migration that builds the rollup from them.
const first = await startCollector();
first.child.kill();
const seedStart = Date.now();
await db.query("DELETE FROM heatmap_rollup");
await db.query(
  `INSERT INTO events (id, project_id, session_id, type, ts, path, x, y, meta_json, viewport_bucket)
   SELECT 'e' || g, $1, 's' || (g % 5000), 'click',
          $2::bigint - (g % 86400000), '/bench', (g * 37) % 1440, (g * 53) % 4000,
          '{"viewport":{"w":' || (CASE WHEN g % 4 = 0 THEN 390 ELSE 1440 END) || ',"h":900,"dpr":2},' ||
          '"device":{"ua":"bench","platform":"linux","language":"en"},"meta":{}}',
          CASE WHEN g % 4 = 0 THEN '400x900' ELSE '1400x900' END
   FROM generate_series(1, $3::int) AS g`,
  [PROJECT_ID, Date.now(), EVENTS]
);
await db.query("ANALYZE events");
console.log(`seeded ${EVENTS} events in ${Date.now() - seedStart} ms`);
const migrateStart = Date.now();
const { child, port } = await startCollector();
await db.query("ANALYZE heatmap_rollup");
const rollupRows = (await db.query("SELECT count(*) AS n FROM heatmap_rollup")).rows[0].n;
console.log(`migrated in ${Date.now() - migrateStart} ms (${rollupRows} rollup rows)`);
const rss = [];
child.on("message", (m) => m.rss && rss.push(m.rss));

const target = `http://127.0.0.1:${port}/api/projects/${PROJECT_ID}/heatmap?path=%2Fbench`;
const warm = await fetch(target);
const body = await warm.json();
if (body.meta.totalEvents !== EVENTS) throw new Error(`expected ${EVENTS} events, got ${body.meta.totalEvents}`);

// Warm up for a fixed time (not a request count) so the heap reaches steady state before RSS is sampled.
const warmupEnd = Date.now() + Number(process.env.BENCH_WARMUP_S || 5) * 1000;
while (Date.now() < warmupEnd) await (await fetch(target)).arrayBuffer();
const baseline = rss.at(-1);
rss.length = 0;
// Async so the RSS samples keep arriving while autocannon runs.
const { stdout: raw } = await promisify(execFile)(
  "npx",
  ["-y", "autocannon@8.0.0", "-j", "-c", String(CONNECTIONS), "-d", String(DURATION_S), target],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
const result = JSON.parse(raw);
child.disconnect();
await db.end();

// autocannon reports p90 and p97.5, not p95; p97.5 is an upper bound for p95.
const p95UpperMs = result.latency.p97_5;
// "Flat" = no growth: median RSS of the last quarter vs the first quarter of the run. The GC
// sawtooth (peak minus trough) is reported too but not gated: it is heap headroom, not growth.
const mb = (bytes) => bytes / 1024 / 1024;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const quarter = Math.max(1, Math.floor(rss.length / 4));
const rssDeltaMb = mb(median(rss.slice(-quarter)) - median(rss.slice(0, quarter)));
const rssSwingMb = mb(Math.max(...rss) - Math.min(...rss));
const summary = {
  events: EVENTS,
  requests: result.requests.total,
  non2xx: result.non2xx,
  errors: result.errors,
  latencyMs: { p50: result.latency.p50, p90: result.latency.p90, p97_5: result.latency.p97_5, p99: result.latency.p99 },
  rssAfterWarmupMb: Math.round(mb(baseline)),
  rssDriftMb: Number(rssDeltaMb.toFixed(1)),
  rssGcSwingMb: Number(rssSwingMb.toFixed(1))
};
console.log(JSON.stringify(summary, null, 2));

const failures = [];
if (result.non2xx > 0 || result.errors > 0) failures.push("non-2xx responses or socket errors");
if (p95UpperMs > P95_BUDGET_MS) failures.push(`p95 (<= p97.5 ${p95UpperMs} ms) over ${P95_BUDGET_MS} ms`);
if (Math.abs(rssDeltaMb) > RSS_BUDGET_MB)
  failures.push(`RSS moved ${rssDeltaMb.toFixed(1)} MB (budget ±${RSS_BUDGET_MB})`);
if (failures.length > 0) {
  console.error(`heatmap bench FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("heatmap bench passed");
