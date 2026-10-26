#!/usr/bin/env node
// Coleta métricas de CI via `gh api` em TSV (baseline "medir após o PR 1").
// Uso: node scripts/ci-metrics.mjs [--repo owner/name] [--days 14] [--out dir] [--max-runs N]
// Gera runs.tsv, jobs.tsv e steps.tsv (uma linha por run/job/step, com head_sha
// para correlacionar workflows do mesmo commit). Requer `gh` autenticado.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const repo = args.repo ?? "m-software-engineering/heat-tracker";
const days = Number(args.days ?? 14);
const out = args.out ?? "ci-metrics";
const maxRuns = Number(args["max-runs"] ?? Infinity);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const gh = (path) =>
  JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", path], { encoding: "utf8", maxBuffer: 1 << 28 }));
const secs = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : "");
const clean = (v) => String(v ?? "").replace(/[\t\n\r]/g, " ");
const tsv = (header, rows) => [header, ...rows].map((r) => r.map(clean).join("\t")).join("\n") + "\n";

const pages = gh(`repos/${repo}/actions/runs?per_page=100&created=>=${since}`);
const total = pages[0]?.total_count ?? 0;
if (total > 1000) {
  console.warn(`aviso: ${total} runs na janela; a API limita a 1000 por busca, reduza --days`);
}
const runs = pages.flatMap((p) => p.workflow_runs).slice(0, maxRuns);

const runRows = [];
const jobRows = [];
const stepRows = [];
for (const r of runs) {
  runRows.push([
    r.id,
    r.name,
    r.event,
    r.head_branch,
    r.head_sha,
    r.run_attempt,
    r.status,
    r.conclusion,
    r.created_at,
    r.run_started_at,
    r.updated_at,
    secs(r.run_started_at, r.updated_at),
    r.pull_requests?.map((p) => p.number).join(",")
  ]);
  const jobs = gh(`repos/${repo}/actions/runs/${r.id}/jobs?filter=all&per_page=100`).flatMap((p) => p.jobs);
  for (const j of jobs) {
    jobRows.push([
      r.id,
      j.id,
      r.name,
      j.name,
      r.event,
      r.head_sha,
      j.run_attempt,
      j.status,
      j.conclusion,
      j.runner_name,
      (j.labels ?? []).join(","),
      j.started_at,
      j.completed_at,
      secs(j.started_at, j.completed_at)
    ]);
    for (const s of j.steps ?? []) {
      stepRows.push([
        r.id,
        j.id,
        r.name,
        j.name,
        s.number,
        s.name,
        s.status,
        s.conclusion,
        s.started_at,
        s.completed_at,
        secs(s.started_at, s.completed_at)
      ]);
    }
  }
}

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "runs.tsv"),
  tsv(
    [
      "run_id",
      "workflow",
      "event",
      "branch",
      "head_sha",
      "attempt",
      "status",
      "conclusion",
      "created_at",
      "started_at",
      "updated_at",
      "duration_s",
      "prs"
    ],
    runRows
  )
);
writeFileSync(
  join(out, "jobs.tsv"),
  tsv(
    [
      "run_id",
      "job_id",
      "workflow",
      "job",
      "event",
      "head_sha",
      "attempt",
      "status",
      "conclusion",
      "runner",
      "labels",
      "started_at",
      "completed_at",
      "duration_s"
    ],
    jobRows
  )
);
writeFileSync(
  join(out, "steps.tsv"),
  tsv(
    [
      "run_id",
      "job_id",
      "workflow",
      "job",
      "step_no",
      "step",
      "status",
      "conclusion",
      "started_at",
      "completed_at",
      "duration_s"
    ],
    stepRows
  )
);
console.log(
  `${repo} desde ${since}: ${runRows.length} runs, ${jobRows.length} jobs, ${stepRows.length} steps -> ${out}/`
);
