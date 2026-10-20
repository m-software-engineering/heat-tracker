#!/usr/bin/env node
// Pre-publish guard for the CD workflow. Read-only: anonymous GETs against the
// npm registry plus local file reads; never writes anything except the
// optional GITHUB_OUTPUT line in `pending` mode.
//
// Usage:
//   node scripts/check-npm-publishable.mjs           # preflight (default)
//   node scripts/check-npm-publishable.mjs pending   # gate: are there pending changesets?
//
// Preflight: for every non-private workspace package whose local version is
// not on npm yet, fail if the package name does not exist on the registry at
// all. npm trusted publishing (OIDC) cannot create a brand-new package, so the
// publish would 404 and leave the release half-published. Workspace packages
// that depend on a missing package also fail. Any failure aborts the job before
// `changeset publish` runs, so nothing in the set gets published. Registry
// errors and timeouts fail closed.
//
// Pending: mirrors changesets/action v1.9.0 (readChangesetState over
// @changesets/read): count
// `.changeset/*.md` (except README.md); in pre mode (`.changeset/pre.json`
// with mode "pre"), ids listed in pre.json `changesets` were already
// versioned and are ignored. Prints and writes `has_changesets=true|false`.
//
// Env:
//   CHECK_NPM_ROOT          repo root to scan (default: cwd).
//   NPM_REGISTRY_URL        registry base URL (default: https://registry.npmjs.org).
//   PREFLIGHT_TIMEOUT_MS    per-request timeout (default: 15000).
//   PREFLIGHT_ATTEMPTS      attempts per package, fail closed after (default: 2).
//   PREFLIGHT_ALLOW_MISSING comma-separated package names deliberately allowed
//                           to be missing (first-publish case). Names not in
//                           the list still fail. See docs/releasing.md.
import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function workspaceDirs(root) {
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
      for (const e of readdirSync(base, { withFileTypes: true })) {
        if (e.isDirectory()) dirs.push(join(base, e.name));
      }
    } else {
      dirs.push(join(root, pattern));
    }
  }
  return dirs.filter((d) => existsSync(join(d, "package.json")));
}

export function publishablePackages(root) {
  return workspaceDirs(root)
    .map((dir) => ({ dir, json: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
    .filter(({ json }) => !json.private && json.name && json.version);
}

export function pendingChangesets(root) {
  const dir = join(root, ".changeset");
  if (!existsSync(dir)) return [];
  // Same filter as @changesets/read getChangesets, including legacy
  // `<id>/changes.json` directories.
  const entries = readdirSync(dir, { withFileTypes: true });
  let ids = [
    ...entries.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "changes.json"))).map((e) => e.name),
    ...entries
      .map((e) => e.name)
      .filter((f) => !f.startsWith(".") && f.endsWith(".md") && !/^README\.md$/i.test(f))
      .map((f) => f.replace(".md", ""))
  ];
  const prePath = join(dir, "pre.json");
  if (existsSync(prePath)) {
    const pre = JSON.parse(readFileSync(prePath, "utf8"));
    if (pre.mode === "pre") {
      const done = new Set(pre.changesets ?? []);
      ids = ids.filter((id) => !done.has(id));
    }
  }
  return ids;
}

function cmpSemver(a, b) {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function fetchPackument(registry, name, { timeoutMs, attempts }) {
  const url = `${registry}/${encodeURIComponent(name).replace(/^%40/, "@")}`;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/vnd.npm.install-v1+json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      if (!doc || typeof doc !== "object" || typeof doc.versions !== "object") {
        throw new Error("unexpected response body");
      }
      return doc;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const reason = lastErr?.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : lastErr?.message;
  throw new Error(`could not query ${url} (${attempts} attempt(s)): ${reason}`, { cause: lastErr });
}

export async function preflight({
  root,
  registry = "https://registry.npmjs.org",
  timeoutMs = 15000,
  attempts = 2,
  allowMissing = [],
  log = console.log
}) {
  registry = registry.replace(/\/+$/, "");
  const allowed = new Set(allowMissing);
  const pkgs = publishablePackages(root);
  const names = new Set(pkgs.map((p) => p.json.name));
  const errors = [];
  const missing = new Set();
  let toPublish = 0;

  for (const { json } of pkgs) {
    const { name, version } = json;
    let doc;
    try {
      doc = await fetchPackument(registry, name, { timeoutMs, attempts });
    } catch (err) {
      errors.push(`${name}: ${err.message}. Failing closed; nothing was published.`);
      continue;
    }
    if (doc === null) {
      toPublish++;
      if (allowed.has(name)) {
        log(`::warning::${name}@${version} is missing on npm but allowed by PREFLIGHT_ALLOW_MISSING.`);
        continue;
      }
      missing.add(name);
      errors.push(
        `${name}@${version}: package does not exist on npm. Trusted publishing (OIDC) cannot create a new package. ` +
          `Publish the first version manually (npm publish --access public), then configure the Trusted Publisher ` +
          `for this repo/workflow on npmjs.com, then rerun the CD workflow. See docs/releasing.md.`
      );
      continue;
    }
    if (Object.keys(doc.versions).includes(version)) {
      log(`ok   ${name}@${version} already on npm (nothing to publish)`);
      continue;
    }
    toPublish++;
    log(`new  ${name}@${version} will be published`);
    const latest = doc["dist-tags"]?.latest;
    if (latest && cmpSemver(version, latest) < 0) {
      log(`::warning::${name}@${version} is lower than npm latest (${latest}); check the version bump.`);
    }
    if (json.publishConfig?.access !== "public" && name.startsWith("@")) {
      log(`::warning::${name} is scoped but publishConfig.access is not "public".`);
    }
  }

  for (const { json } of pkgs) {
    const deps = { ...json.dependencies, ...json.peerDependencies, ...json.optionalDependencies };
    for (const dep of Object.keys(deps)) {
      if (names.has(dep) && missing.has(dep)) {
        errors.push(`${json.name} depends on ${dep}, which is missing on npm; publishing it would break installs.`);
      }
    }
  }

  for (const e of errors) log(`::error::${e}`);
  if (errors.length) {
    log(`Preflight failed: ${errors.length} error(s). Nothing was published.`);
    return 1;
  }
  log(toPublish ? `Preflight ok: ${toPublish} package(s) to publish.` : "Preflight ok: nothing to publish.");
  return 0;
}

async function main() {
  const root = resolve(process.env.CHECK_NPM_ROOT ?? process.cwd());
  if (process.argv[2] === "pending") {
    const ids = pendingChangesets(root);
    const line = `has_changesets=${ids.length > 0}`;
    console.log(`${line}${ids.length ? ` (${ids.join(", ")})` : ""}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    return 0;
  }
  return preflight({
    root,
    registry: process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org",
    timeoutMs: Number(process.env.PREFLIGHT_TIMEOUT_MS ?? 15000),
    attempts: Number(process.env.PREFLIGHT_ATTEMPTS ?? 2),
    allowMissing: (process.env.PREFLIGHT_ALLOW_MISSING ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.log(`::error::check-npm-publishable failed: ${err.message}`);
      process.exit(1);
    }
  );
}
