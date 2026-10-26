#!/usr/bin/env node
// Garante uma única versão do Playwright no lockfile e que qualquer imagem
// mcr.microsoft.com/playwright:vX referenciada nos workflows use essa versão.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function lockfileVersions(lock) {
  const versions = new Set();
  for (const m of lock.matchAll(/^ {2}'?(?:@playwright\/test|playwright|playwright-core)@(\d+\.\d+\.\d+)'?:/gm))
    versions.add(m[1]);
  return [...versions];
}

export function imageVersions(text) {
  return [...text.matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
}

export function checkPin(root, log = console.log) {
  const versions = lockfileVersions(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  if (versions.length !== 1) {
    log(`playwright: esperado 1 versão no lockfile, encontrado ${versions.length} (${versions.join(", ")})`);
    return false;
  }
  const [version] = versions;
  let ok = true;
  const dir = join(root, ".github/workflows");
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const v of imageVersions(readFileSync(join(dir, file), "utf8"))) {
      if (v !== version) {
        log(`playwright: ${file} usa imagem v${v}, lockfile tem ${version}`);
        ok = false;
      }
    }
  }
  if (ok) log(`playwright: ${version} (lockfile e workflows consistentes)`);
  return ok;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = checkPin(process.cwd()) ? 0 : 1;
}
