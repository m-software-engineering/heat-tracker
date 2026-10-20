import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflight, pendingChangesets } from "./check-npm-publishable.mjs";

// Fake registry: `registry` maps name -> versions[] | "500" | "hang".
let registry = {};
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  const entry = registry[name];
  if (entry === "hang") return;
  if (entry === "500") return res.writeHead(500).end();
  if (!entry) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({ "dist-tags": { latest: entry.at(-1) }, versions: Object.fromEntries(entry.map((v) => [v, {}])) })
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.closeAllConnections();
  server.close();
});

function repo(pkgs, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "preflight-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "examples/*"\n');
  for (const [dir, json] of Object.entries(pkgs)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify({ publishConfig: { access: "public" }, ...json }));
  }
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  return root;
}

async function run(root, opts = {}) {
  const lines = [];
  const code = await preflight({
    root,
    registry: url,
    timeoutMs: 300,
    attempts: 2,
    log: (l) => lines.push(l),
    ...opts
  });
  return { code, out: lines.join("\n") };
}

const base = {
  "packages/a": { name: "@s/a", version: "1.0.0" },
  "packages/b": { name: "@s/b", version: "2.0.0", dependencies: { "@s/a": "workspace:*" } }
};

test("nothing to publish passes", async () => {
  registry = { "@s/a": ["1.0.0"], "@s/b": ["2.0.0"] };
  const r = await run(repo(base));
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing to publish/);
});

test("new version of an existing package passes", async () => {
  registry = { "@s/a": ["0.9.0"], "@s/b": ["2.0.0"] };
  const r = await run(repo(base));
  assert.equal(r.code, 0);
  assert.match(r.out, /new {2}@s\/a@1.0.0/);
});

test("missing package fails, and its dependent fails too", async () => {
  registry = { "@s/b": ["1.0.0"] };
  const r = await run(repo(base));
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /::error::@s\/a@1.0.0: package does not exist on npm.*Publish the first version manually.*Trusted Publisher.*rerun/
  );
  assert.match(r.out, /::error::@s\/b depends on @s\/a, which is missing/);
});

test("private packages and private examples are ignored; public examples are checked", async () => {
  registry = { "@s/a": ["1.0.0"], "@s/b": ["2.0.0"] };
  const root = repo({
    ...base,
    "packages/priv": { name: "@s/priv", version: "1.0.0", private: true },
    "examples/demo": { name: "demo", version: "0.0.0", private: true }
  });
  assert.equal((await run(root)).code, 0);
  const root2 = repo({ ...base, "examples/pub": { name: "@s/pub-example", version: "0.1.0" } });
  const r = await run(root2);
  assert.equal(r.code, 1);
  assert.match(r.out, /@s\/pub-example@0.1.0: package does not exist/);
});

test("registry 500 fails closed with a single ::error:: line", async () => {
  registry = { "@s/a": "500", "@s/b": ["2.0.0"] };
  const r = await run(repo(base));
  assert.equal(r.code, 1);
  assert.match(r.out, /^::error::@s\/a: could not query .* \(2 attempt\(s\)\): HTTP 500\. Failing closed/m);
  assert.doesNotMatch(r.out, /\n\s+at /);
});

test("registry that never responds times out and fails closed", async () => {
  registry = { "@s/a": "hang", "@s/b": ["2.0.0"] };
  const t0 = Date.now();
  const r = await run(repo(base));
  assert.equal(r.code, 1);
  assert.match(r.out, /timed out after 300ms/);
  assert.ok(Date.now() - t0 < 5000);
});

test("PREFLIGHT_ALLOW_MISSING allows listed names only", async () => {
  registry = { "@s/b": ["2.0.0"] };
  const allowed = await run(repo(base), { allowMissing: ["@s/a"] });
  assert.equal(allowed.code, 0);
  assert.match(allowed.out, /::warning::@s\/a@1.0.0 is missing on npm but allowed/);
  registry = {};
  const partial = await run(repo(base), { allowMissing: ["@s/a"] });
  assert.equal(partial.code, 1);
  assert.match(partial.out, /::error::@s\/b@2.0.0: package does not exist/);
});

test("pending: counts .md changesets except README and dotfiles", () => {
  assert.deepEqual(pendingChangesets(repo({}, { ".changeset/config.json": "{}" })), []);
  const root = repo({}, { ".changeset/README.md": "", ".changeset/.x.md": "", ".changeset/foo.md": "" });
  assert.deepEqual(pendingChangesets(root), ["foo"]);
});

test("pending: pre mode ignores changesets already listed in pre.json", () => {
  const pre = (mode, ids) => JSON.stringify({ mode, tag: "next", initialVersions: {}, changesets: ids });
  const consumed = repo({}, { ".changeset/pre.json": pre("pre", ["foo"]), ".changeset/foo.md": "" });
  assert.deepEqual(pendingChangesets(consumed), []);
  const fresh = repo(
    {},
    { ".changeset/pre.json": pre("pre", ["foo"]), ".changeset/foo.md": "", ".changeset/bar.md": "" }
  );
  assert.deepEqual(pendingChangesets(fresh), ["bar"]);
  const exited = repo({}, { ".changeset/pre.json": pre("exit", ["foo"]), ".changeset/foo.md": "" });
  assert.deepEqual(pendingChangesets(exited), ["foo"]);
});
