import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteComposeTags, syncComposeTag } from "./sync-compose-tag.mjs";

const COMPOSE = [
  "services:",
  "  collector:",
  "    image: ghcr.io/m-software-engineering/heat-collector:0.4.0",
  "  dashboard:",
  "    image: ghcr.io/m-software-engineering/heat-dashboard:0.4.0",
  "  db:",
  "    image: postgres:16-alpine",
  "  other:",
  "    image: ghcr.io/someone-else/heat-collector:0.1.0",
  ""
].join("\n");

function repo({ compose = COMPOSE, version = "0.5.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "compose-sync-"));
  mkdirSync(join(root, "packages/heat-collector"), { recursive: true });
  writeFileSync(join(root, "packages/heat-collector/package.json"), JSON.stringify({ version }));
  if (compose !== null) writeFileSync(join(root, "docker-compose.yml"), compose);
  return root;
}

test("rewrites only our collector and dashboard tags", () => {
  const out = rewriteComposeTags(COMPOSE, "1.2.3");
  assert.match(out, /heat-collector:1\.2\.3/);
  assert.match(out, /heat-dashboard:1\.2\.3/);
  assert.match(out, /postgres:16-alpine/);
  assert.match(out, /someone-else\/heat-collector:0\.1\.0/);
});

test("updates docker-compose.yml to the heat-collector version", () => {
  const root = repo();
  assert.deepEqual(syncComposeTag(root), { changed: true, version: "0.5.0" });
  const out = readFileSync(join(root, "docker-compose.yml"), "utf8");
  assert.equal((out.match(/:0\.5\.0/g) ?? []).length, 2);
});

test("no-op when already in sync", () => {
  const root = repo({ version: "0.4.0" });
  assert.deepEqual(syncComposeTag(root), { changed: false, version: "0.4.0" });
  assert.equal(readFileSync(join(root, "docker-compose.yml"), "utf8"), COMPOSE);
});

test("no-op when docker-compose.yml is missing", () => {
  assert.deepEqual(syncComposeTag(repo({ compose: null })), { changed: false });
});

test("no-op when compose has no matching images", () => {
  const compose = "services:\n  db:\n    image: postgres:16\n";
  const root = repo({ compose });
  assert.equal(syncComposeTag(root).changed, false);
  assert.equal(readFileSync(join(root, "docker-compose.yml"), "utf8"), compose);
});

test("rejects an invalid version", () => {
  assert.throws(() => syncComposeTag(repo({ version: "not a version" })), /invalid heat-collector version/);
});
