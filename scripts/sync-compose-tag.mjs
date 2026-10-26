#!/usr/bin/env node
// Rewrites ghcr.io/m-software-engineering/heat-(collector|dashboard) image tags in the
// root docker-compose.yml to the current heat-collector version. Runs after
// `changeset version` so the compose file always points at the images CD publishes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_RE = /(ghcr\.io\/m-software-engineering\/heat-(?:collector|dashboard)):[0-9A-Za-z._-]+/g;

export function rewriteComposeTags(source, version) {
  return source.replace(IMAGE_RE, (_, image) => `${image}:${version}`);
}

export function syncComposeTag(root = process.cwd()) {
  const composePath = join(root, "docker-compose.yml");
  const pkgPath = join(root, "packages/heat-collector/package.json");
  if (!existsSync(composePath) || !existsSync(pkgPath)) return { changed: false };
  const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid heat-collector version: ${version}`);
  }
  const before = readFileSync(composePath, "utf8");
  const after = rewriteComposeTags(before, version);
  if (after === before) return { changed: false, version };
  writeFileSync(composePath, after);
  return { changed: true, version };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { changed, version } = syncComposeTag();
  console.log(
    changed ? `docker-compose.yml image tags set to ${version}` : "docker-compose.yml image tags already in sync"
  );
}
