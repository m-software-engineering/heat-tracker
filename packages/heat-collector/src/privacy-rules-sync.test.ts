import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// privacy-rules.ts is duplicated byte-for-byte into the collector and the
// dashboard example. The SDK copy is the source of truth; this guard fails fast
// in unit CI when a copy drifts (previously only caught by the e2e suite).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));

const source = read("../../heat-sdk/src/privacy-rules.ts");
const copies = {
  "packages/heat-collector/src/privacy-rules.ts": "./privacy-rules.ts",
  "examples/nextjs-dashboard/lib/privacy-rules.ts": "../../../examples/nextjs-dashboard/lib/privacy-rules.ts"
};

describe("privacy-rules copies", () => {
  for (const [name, rel] of Object.entries(copies)) {
    it(`${name} is byte-identical to the SDK copy`, () => {
      expect(read(rel).equals(source), `${name} drifted; copy packages/heat-sdk/src/privacy-rules.ts over it`).toBe(
        true
      );
    });
  }
});
