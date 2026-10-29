import { describe, expect, it } from "vitest";
import { loadDriver } from "./load-driver";

const missing = (spec: string) =>
  Object.assign(new Error(`Cannot find package '${spec}' imported from /app/db.js`), { code: "ERR_MODULE_NOT_FOUND" });

describe("loadDriver", () => {
  it("turns a missing driver into HEAT_E_DB_DRIVER_MISSING with the install command", async () => {
    await expect(loadDriver("pg", () => Promise.reject(missing("pg")))).rejects.toMatchObject({
      code: "HEAT_E_DB_DRIVER_MISSING",
      cause: 'database driver "pg" is not installed; run: npm install pg'
    });
  });

  it("passes other failures through unchanged", async () => {
    const other = missing("some-other-module");
    await expect(loadDriver("pg", () => Promise.reject(other))).rejects.toBe(other);
  });

  it("returns the loaded module", async () => {
    await expect(loadDriver("pg", async () => ({ Pool: 1 }))).resolves.toEqual({ Pool: 1 });
  });
});
