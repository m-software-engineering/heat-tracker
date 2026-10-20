import { describe, expect, it } from "vitest";
import { maskSecrets, migrationFailureCause } from "./cli-errors";
import { autoMigrate, createDb } from "./db";

const PASSWORD = "s3cr%40t-pw";
const DECODED = "s3cr@t-pw";
const URL_PG = `postgres://heat:${PASSWORD}@db.internal:5433/heat?sslmode=require`;

const driverError = (name: string, props: Record<string, unknown>) =>
  Object.assign(Object.create({ constructor: { name } }), { message: "boom", ...props });

describe("migrationFailureCause", () => {
  it("names the driver error class, code, and host without credentials", () => {
    const err = driverError("DatabaseError", {
      code: "28P01",
      message: `password authentication failed for user "heat" (${URL_PG})`
    });
    const cause = migrationFailureCause(err, { dialect: "pg", connectionString: URL_PG });

    expect(cause).toBe("DatabaseError 28P01 (pg at db.internal:5433)");
    expect(cause).not.toContain("heat:");
    expect(cause).not.toContain("authentication failed");
  });

  it("uses the first inner error code of an AggregateError", () => {
    const AggregateErrorCtor = (globalThis as unknown as { AggregateError: new (errors: unknown[]) => Error })
      .AggregateError;
    const err = new AggregateErrorCtor([Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]);
    expect(migrationFailureCause(err, { dialect: "mysql", connectionString: "mysql://u:p@localhost/db" })).toBe(
      "AggregateError ECONNREFUSED (mysql at localhost)"
    );
  });

  it("adds the raw message only with --verbose, with the password and connection string masked", () => {
    const err = driverError("DatabaseError", {
      code: "28P01",
      message: `failed for ${URL_PG} password=${DECODED} pass ${PASSWORD} and ${DECODED}`
    });
    const cause = migrationFailureCause(err, { dialect: "pg", connectionString: URL_PG, verbose: true });

    expect(cause).toMatch(/^DatabaseError 28P01 \(pg at db\.internal:5433\): failed for postgres:\/\/heat:\*\*\*@/);
    expect(cause).not.toContain(URL_PG);
    expect(cause).not.toContain(PASSWORD);
    expect(cause).not.toContain(DECODED);
  });

  it("reports the driver error wrapped by the ORM", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const wrapped = Object.assign(new Error("Failed query: create table ... params: secret"), { cause: driver });
    expect(
      migrationFailureCause(wrapped, { dialect: "pg", connectionString: "postgres://h:5432/db", verbose: true })
    ).toBe("Error ECONNREFUSED (pg at h:5432): connect ECONNREFUSED");
  });

  it("handles missing or unparseable connection strings and sqlite", () => {
    expect(migrationFailureCause(new TypeError("x"), { dialect: "pg" })).toBe("TypeError (pg at no DATABASE_URL)");
    expect(migrationFailureCause("str", { dialect: "pg", connectionString: "not a url" })).toBe(
      "string (pg at unparseable DATABASE_URL)"
    );
    expect(migrationFailureCause(new Error("x"), { dialect: "sqlite", file: "/tmp/h.db" })).toBe(
      "Error (sqlite at sqlite file /tmp/h.db)"
    );
  });

  it("masks credentials in unknown URLs and password pairs", () => {
    expect(maskSecrets("mongodb://admin:hunter2@h/db PASSWORD: 'x y' password=abc;")).toBe(
      "mongodb://admin:***@h/db PASSWORD: *** password=***;"
    );
  });

  it("describes a real pg connection failure without leaking the password", async () => {
    const connectionString = `postgres://heat:${PASSWORD}@127.0.0.1:1/heat`;
    const ctx = await createDb({ dialect: "pg", connectionString });
    const err = await autoMigrate(ctx).catch((e) => e);
    await (ctx.db as { $client?: { end?: () => Promise<void> } }).$client?.end?.();

    const cause = migrationFailureCause(err, { dialect: "pg", connectionString, verbose: true });
    expect(cause).toMatch(/ECONNREFUSED \(pg at 127\.0\.0\.1:1\)/);
    expect(cause).not.toContain(PASSWORD);
    expect(cause).not.toContain(DECODED);
  });
});
