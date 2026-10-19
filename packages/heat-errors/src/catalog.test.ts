import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHeatError, getCatalog, renderErrorsMarkdown } from "./index";

const entries = Object.entries(getCatalog());

describe("catalog", () => {
  it.each(entries)("%s has a valid shape", (key, def) => {
    expect(def.code).toBe(key);
    expect(def.code).toMatch(/^HEAT_E_[A-Z0-9_]+$/);
    expect(def.message).toMatch(/^[^\n]+\.$/);
    expect(def.message.toLowerCase()).not.toContain("something went wrong");
    expect(def.fix).toMatch(/^[A-Z][a-z]+ /);

    const err = createHeatError(def, "cause");
    expect(err.docs).toBe(
      `https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md#${key.toLowerCase()}`
    );
    if ("status" in def) {
      expect(err.status).toBe(def.status);
      expect(def.status).toBeGreaterThanOrEqual(400);
      expect(def.legacyCode).toMatch(/^[a-z_]+$/);
    } else {
      expect(err).not.toHaveProperty("status");
    }
  });

  it("pins the HTTP status of every collector code", () => {
    const statuses = Object.fromEntries(
      entries.filter(([, d]) => "status" in d).map(([k, d]) => [k, (d as { status: number }).status])
    );
    expect(statuses).toMatchSnapshot();
  });

  it("keeps docs/errors.md in sync with the catalog", () => {
    const file = fileURLToPath(new URL("../../../docs/errors.md", import.meta.url));
    expect(readFileSync(file, "utf8"), "run: corepack pnpm -C packages/heat-errors docs:errors").toBe(
      renderErrorsMarkdown()
    );
  });
});
