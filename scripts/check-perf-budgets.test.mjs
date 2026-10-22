import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBudgets } from "./check-perf-budgets.mjs";

const repo = (budgets) => {
  const root = mkdtempSync(join(tmpdir(), "perf-budgets-"));
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/a.js"), `export const answer = ${JSON.stringify("x".repeat(50))};\n`);
  writeFileSync(join(root, "perf-budgets.json"), JSON.stringify({ budgets }));
  return root;
};
const sdk = (maxBytes) => ({ name: "a", kind: "min+gzip", file: "dist/a.js", build: "build it", maxBytes });
const run = (root) => {
  const lines = [];
  return { ok: checkBudgets(root, undefined, (l) => lines.push(l)), out: lines.join("\n") };
};

test("passes and prints measured vs limit when under budget", () => {
  const { ok, out } = run(repo([sdk(10_000)]));
  assert.equal(ok, true);
  assert.match(out, /^PASS {2}a: \d+ B \/ limit 10000 B/m);
});

test("fails with the overage and a fix line when over budget", () => {
  const { ok, out } = run(repo([sdk(10_000), sdk(5)]));
  assert.equal(ok, false);
  assert.match(out, /^FAIL {2}a: \d+ B \/ limit 5 B/m);
  assert.match(out, /over by \d+ B\. Fix:/);
  assert.match(out, /1 of 2 budgets failed/);
});

test("a missing artifact fails and says how to build it", () => {
  const root = repo([{ ...sdk(10_000), file: "dist/missing.js" }]);
  const { ok, out } = run(root);
  assert.equal(ok, false);
  assert.match(out, /not measured \(dist\/missing\.js not found; build it\)/);
});
