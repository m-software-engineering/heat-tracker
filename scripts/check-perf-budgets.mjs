#!/usr/bin/env node
// Size budgets (#30): compares built artifacts against perf-budgets.json and exits 1 if any is over.
// Needs: the SDK built (packages/heat-sdk/dist) and the dashboard built (examples/nextjs-dashboard/.next).
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Minify like a site's bundler would before gzip. esbuild ships with tsup (a root dev dependency);
// resolved through it so no second copy is installed.
const require = createRequire(import.meta.url);
const { transformSync } = require(require.resolve("esbuild", { paths: [require.resolve("tsup")] }));

const gzipBytes = (code) => gzipSync(code, { level: 9 }).length;

const minGzip = (file) => gzipBytes(transformSync(readFileSync(file, "utf8"), { minify: true, loader: "js" }).code);

const dashboardRouteJs = (root, route) => {
  const nextDir = join(root, "examples/nextjs-dashboard/.next");
  const manifest = JSON.parse(readFileSync(join(nextDir, "app-build-manifest.json"), "utf8"));
  const files = new Set([...(manifest.pages["/layout"] ?? []), ...(manifest.pages[route] ?? [])]);
  if (!manifest.pages[route]) throw new Error(`route ${route} not in app-build-manifest.json`);
  let total = 0;
  for (const f of files) if (f.endsWith(".js")) total += gzipBytes(readFileSync(join(nextDir, f)));
  return total;
};

/** Measures one budget entry; throws with a "build first" hint if its artifact is missing. */
const measure = (root, budget) => {
  if (budget.kind === "min+gzip") {
    const file = join(root, budget.file);
    if (!existsSync(file)) throw new Error(`${budget.file} not found; ${budget.build}`);
    return minGzip(file);
  }
  if (budget.kind === "next-route-gzip") {
    const manifest = join(root, "examples/nextjs-dashboard/.next/app-build-manifest.json");
    if (!existsSync(manifest)) throw new Error(`dashboard build not found; ${budget.build}`);
    return dashboardRouteJs(root, budget.route);
  }
  throw new Error(`unknown budget kind ${JSON.stringify(budget.kind)}`);
};

export const checkBudgets = (root, budgetsFile = join(root, "perf-budgets.json"), log = console.log) => {
  const { budgets } = JSON.parse(readFileSync(budgetsFile, "utf8"));
  let failed = 0;
  for (const budget of budgets) {
    let line;
    try {
      const value = measure(root, budget);
      const delta = value - budget.maxBytes;
      const ok = delta <= 0;
      if (!ok) failed++;
      const pct = ((value / budget.maxBytes) * 100).toFixed(1);
      line = `${ok ? "PASS" : "FAIL"}  ${budget.name}: ${value} B / limit ${budget.maxBytes} B (${pct} %)`;
      if (!ok)
        line += `\n      over by ${delta} B. Fix: shrink it, or raise maxBytes in perf-budgets.json with a reason in the PR.`;
    } catch (err) {
      failed++;
      line = `FAIL  ${budget.name}: not measured (${err.message})`;
    }
    log(line);
  }
  log(failed ? `\n${failed} of ${budgets.length} budgets failed.` : `\nAll ${budgets.length} budgets passed.`);
  return failed === 0;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, "..");
  process.exitCode = checkBudgets(root, process.argv[2] ? resolve(process.argv[2]) : undefined) ? 0 : 1;
}
