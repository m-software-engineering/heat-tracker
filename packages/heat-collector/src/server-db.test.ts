import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { startFakePostgres } from "./__fixtures__/fake-postgres";
import { createLogger } from "./logger";
import { connectDb } from "./server-db";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname.endsWith(".invalid")) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    }
    return { address: hostname, family: 4 };
  })
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

const waitFor = async (check: () => boolean, ms = 2_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("connectDb (pg)", () => {
  it("survives a terminated idle connection, logs HEAT_E_DB_CONNECTION_LOST, and reconnects", async () => {
    const pg = await startFakePostgres();
    cleanups.push(pg.close);
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      logged.push(String(line));
    });
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    cleanups.push(async () => {
      process.off("uncaughtException", uncaught);
    });

    const ctx = await connectDb({ dialect: "pg", connectionString: pg.url }, createLogger("error"));
    cleanups.push(() => ctx.db.$client.end());
    await waitFor(() => pg.openConnections() === 1);

    pg.terminateAll(); // what `pg_ctl stop -m fast` does to idle backends
    await waitFor(() => logged.some((line) => line.includes("HEAT_E_DB_CONNECTION_LOST")));
    expect(uncaught).not.toHaveBeenCalled();
    const entry = JSON.parse(logged.find((line) => line.includes("HEAT_E_DB_CONNECTION_LOST"))!);
    expect(entry.cause).toContain(`127.0.0.1:${new URL(pg.url).port}`);
    expect(JSON.stringify(entry)).not.toContain("secret");

    const before = pg.queries();
    await ctx.db.execute(sql`select 1`);
    expect(pg.queries()).toBe(before + 1);
    expect(pg.openConnections()).toBe(1);
  });

  it("fails with HEAT_E_DB_UNREACHABLE naming ENOTFOUND when the host does not resolve", async () => {
    const err = await connectDb(
      { dialect: "pg", connectionString: "postgres://heat:pw@db.does-not-exist.invalid:5432/x" },
      createLogger("error")
    ).catch((e) => e);
    expect(err.code).toBe("HEAT_E_DB_UNREACHABLE");
    expect(err.cause).toContain("ENOTFOUND");
    expect(err.cause).toContain("db.does-not-exist.invalid:5432");
    expect(err.cause).not.toContain("pw");
  });
});
