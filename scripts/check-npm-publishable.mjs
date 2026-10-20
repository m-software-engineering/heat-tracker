#!/usr/bin/env node
// Pre-publish guard for the CD workflow. Read-only: performs anonymous GETs
// against the npm registry and never writes anything.
//
// For every non-private workspace package whose local version is not on npm
// yet, fail if the package name does not exist on the registry at all: npm
// trusted publishing (OIDC) cannot create a brand-new package, so the publish
// would 404 and leave the release half-published. Any failure aborts the job
// before `changeset publish` runs, so nothing in the set gets published.
//
// Env:
//   CHECK_NPM_ROOT      repo root to scan (default: cwd). Useful for tests.
//   NPM_REGISTRY_URL    registry base URL (default: https://registry.npmjs.org).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.env.CHECK_NPM_ROOT ?? process.cwd());
const registry = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/+$/, "");

function workspaceDirs() {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const dirs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) inPackages = false;
    const m = inPackages && line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/);
    if (!m) continue;
    const pattern = m[1];
    if (pattern.endsWith("/*")) {
      const base = join(root, pattern.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const e of readdirSync(base, { withFileTypes: true })) if (e.isDirectory()) dirs.push(join(base, e.name));
    } else {
      dirs.push(join(root, pattern));
    }
  }
  return dirs.filter((d) => existsSync(join(d, "package.json")));
}

function cmpSemver(a, b) {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

async function fetchPackument(name) {
  const url = `${registry}/${encodeURIComponent(name).replace(/^%40/, "@")}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`could not query ${url}: ${err.message}`, { cause: err });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const pkgs = workspaceDirs()
  .map((dir) => ({ dir, json: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
  .filter(({ json }) => !json.private && json.name && json.version);

const names = new Set(pkgs.map((p) => p.json.name));
const errors = [];
const missing = new Set();
let toPublish = 0;

for (const { json } of pkgs) {
  const { name, version } = json;
  const doc = await fetchPackument(name);
  if (doc === null) {
    missing.add(name);
    toPublish++;
    errors.push(
      `${name}@${version}: package does not exist on npm. Trusted publishing (OIDC) cannot create a new package. ` +
        `Publish the first version manually (npm publish --access public), then configure the Trusted Publisher ` +
        `for this repo/workflow on npmjs.com, then rerun the CD workflow.`
    );
    continue;
  }
  const versions = Object.keys(doc.versions ?? {});
  if (versions.includes(version)) {
    console.log(`ok   ${name}@${version} already on npm (nothing to publish)`);
    continue;
  }
  toPublish++;
  console.log(`new  ${name}@${version} will be published`);
  const latest = doc["dist-tags"]?.latest;
  if (latest && cmpSemver(version, latest) < 0) {
    console.log(`::warning::${name}@${version} is lower than npm latest (${latest}); check the version bump.`);
  }
  if (json.publishConfig?.access !== "public" && name.startsWith("@")) {
    console.log(`::warning::${name} is scoped but publishConfig.access is not "public".`);
  }
}

// Dependents of a missing package would ship broken installs; call them out.
for (const { json } of pkgs) {
  const deps = { ...json.dependencies, ...json.peerDependencies, ...json.optionalDependencies };
  for (const dep of Object.keys(deps)) {
    if (names.has(dep) && missing.has(dep)) {
      errors.push(`${json.name} depends on ${dep}, which is missing on npm; publishing it would break installs.`);
    }
  }
}

for (const e of errors) console.log(`::error::${e}`);
if (errors.length) {
  console.log(`Preflight failed: ${errors.length} error(s). Nothing was published.`);
  process.exit(1);
}
console.log(toPublish ? `Preflight ok: ${toPublish} package(s) to publish.` : "Preflight ok: nothing to publish.");
