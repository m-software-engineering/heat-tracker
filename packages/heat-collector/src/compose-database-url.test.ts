import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";

// #74: the root docker-compose.yml must not interpolate POSTGRES_PASSWORD into DATABASE_URL unencoded.
const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
const collectorEnv = (name: string) =>
  compose
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2);

describe("docker-compose collector database settings", () => {
  it("keeps the password out of DATABASE_URL and passes it as PGPASSWORD", () => {
    expect(collectorEnv("DATABASE_URL")).toBe("postgres://heat@postgres:5432/heat_tracker");
    expect(collectorEnv("PGPASSWORD")).toBe("${POSTGRES_PASSWORD:-heat}");
  });

  it("connects with a password containing @ : / # ? as-is", () => {
    const password = "p@ss:w/rd#x?y";
    const saved = process.env.PGPASSWORD;
    process.env.PGPASSWORD = password;
    try {
      const client = new pg.Client({ connectionString: collectorEnv("DATABASE_URL") });
      expect(client.host).toBe("postgres");
      expect(client.database).toBe("heat_tracker");
      expect(client.user).toBe("heat");
      expect(client.password).toBe(password);
    } finally {
      if (saved === undefined) delete process.env.PGPASSWORD;
      else process.env.PGPASSWORD = saved;
    }
  });
});
