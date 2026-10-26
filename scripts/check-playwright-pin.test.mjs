import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPin } from "./check-playwright-pin.mjs";

const repo = (lock, workflow) => {
  const root = mkdtempSync(join(tmpdir(), "pw-pin-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, "pnpm-lock.yaml"), lock);
  writeFileSync(join(root, ".github/workflows/ci.yml"), workflow);
  return root;
};
const lock = (v) => `packages:\n\n  '@playwright/test@${v}':\n    x: y\n\n  playwright@${v}:\n    x: y\n`;
const quiet = () => {};

test("passa sem imagem e com versão única", () =>
  assert.equal(checkPin(repo(lock("1.58.0"), "jobs: {}\n"), quiet), true));
test("passa com imagem na mesma versão", () =>
  assert.equal(
    checkPin(repo(lock("1.58.0"), "image: mcr.microsoft.com/playwright:v1.58.0-noble@sha256:ab\n"), quiet),
    true
  ));
test("falha com imagem divergente", () =>
  assert.equal(checkPin(repo(lock("1.58.0"), "image: mcr.microsoft.com/playwright:v1.57.0-noble\n"), quiet), false));
test("falha com duas versões no lockfile", () =>
  assert.equal(checkPin(repo(lock("1.58.0") + lock("1.57.0").replace("packages:\n", ""), "{}\n"), quiet), false));
test("repositório atual está consistente", () => assert.equal(checkPin(process.cwd(), quiet), true));
