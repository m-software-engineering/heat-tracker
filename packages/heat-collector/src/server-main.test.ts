import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTrustProxy, runServer } from "./server-main";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const sqliteEnv = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-server-"));
  return { HEAT_DIALECT: "sqlite", SQLITE_FILE: path.join(dir, "db.sqlite"), HEAT_DATA_DIR: dir, PORT: "0" };
};

const start = async (env: Record<string, string>) => {
  const lines: string[] = [];
  const server = (await runServer([], env, { out: (l) => lines.push(l) }))!;
  servers.push(server);
  return { server, output: lines.join("\n") };
};

const tokenIn = (output: string) => output.match(/Admin token:\s+(\S+)/)?.[1];

describe("heat-collector server", () => {
  it("generates a token, stores it 0600 and prints the banner with the show-again command", async () => {
    const env = sqliteEnv();
    const { output } = await start(env);
    const token = tokenIn(output);
    expect(token).toMatch(/^heat_admin_/);
    expect(output).toContain("Dashboard:    http://localhost:3000");
    expect(output).toContain("docker compose exec collector heat-collector token");
    const file = path.join(env.HEAT_DATA_DIR, "admin-token");
    expect(readFileSync(file, "utf8").trim()).toBe(token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("reuses the stored token on restart and prints it with `token`", async () => {
    const env = sqliteEnv();
    const first = tokenIn((await start(env)).output);
    const second = tokenIn((await start(env)).output);
    expect(second).toBe(first);
    const lines: string[] = [];
    await runServer(["token"], env, { out: (l) => lines.push(l) });
    expect(lines).toEqual([first]);
  });

  it("protects the read API, serves /healthz and answers ingest preflights", async () => {
    const { server, output } = await start(sqliteEnv());
    await request(server).get("/healthz").expect(200, { ok: true });
    const denied = await request(server).get("/api/metrics").expect(401);
    expect(denied.body.error.code).toBe("HEAT_E_ADMIN_TOKEN_MISSING");
    await request(server)
      .get("/api/metrics")
      .set("Authorization", `Bearer ${tokenIn(output)}`)
      .expect(200);
    const preflight = await request(server)
      .options("/ingest")
      .set("Origin", "https://shop.example.com")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://shop.example.com");
    expect(preflight.headers["access-control-allow-headers"]).toContain("x-project-key");
    const api = await request(server).get("/api/metrics").set("Origin", "https://evil.example");
    expect(api.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("prefers HEAT_ADMIN_TOKEN over the stored file", async () => {
    const strong = "x".repeat(32);
    const { output } = await start({ ...sqliteEnv(), HEAT_ADMIN_TOKEN: strong });
    expect(tokenIn(output)).toBe(strong);
  });

  it("rejects a HEAT_ADMIN_TOKEN shorter than 32 characters with HEAT_E_ADMIN_TOKEN_WEAK", async () => {
    const err = await runServer([], { ...sqliteEnv(), HEAT_ADMIN_TOKEN: "short-token" }, { out: () => {} }).catch(
      (e) => e
    );
    expect(err.code).toBe("HEAT_E_ADMIN_TOKEN_WEAK");
    expect(err.cause).toBe("HEAT_ADMIN_TOKEN has 11 characters; at least 32 are required");
    expect(err.cause).not.toContain("short-token");
  });

  it.each(["", "   \n"])(
    "fails with HEAT_E_ADMIN_TOKEN_FILE_INVALID (not EEXIST) for a token file %j",
    async (body) => {
      const env = sqliteEnv();
      writeFileSync(path.join(env.HEAT_DATA_DIR, "admin-token"), body);
      for (const argv of [[], ["token"]]) {
        const err = await runServer(argv, env, { out: () => {} }).catch((e) => e);
        expect(err.code).toBe("HEAT_E_ADMIN_TOKEN_FILE_INVALID");
        expect(err.fix).toContain("rm /data/admin-token");
      }
    }
  );

  it("accepts HEAT_TRUST_PROXY=true and reports bad values as HEAT_E_SERVER_CONFIG, not a database error", async () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("FALSE")).toBe(false);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("loopback, 10.0.0.0/8")).toEqual(["loopback", "10.0.0.0/8"]);
    await start({ ...sqliteEnv(), HEAT_TRUST_PROXY: "true" });
    const err = await runServer([], { ...sqliteEnv(), HEAT_TRUST_PROXY: "yes please" }, { out: () => {} }).catch(
      (e) => e
    );
    expect(err.code).toBe("HEAT_E_SERVER_CONFIG");
    expect(err.cause).toContain("HEAT_TRUST_PROXY");
  });

  it("fails fast with HEAT_E_DB_CONFIG when DATABASE_URL is missing", async () => {
    await expect(runServer([], { HEAT_DIALECT: "pg" }, { out: () => {} })).rejects.toMatchObject({
      code: "HEAT_E_DB_CONFIG",
      cause: "DATABASE_URL is not set (HEAT_DIALECT=pg)"
    });
  });

  it("fails fast with HEAT_E_DB_UNREACHABLE naming host:port but not the password", async () => {
    const err = await runServer(
      [],
      { DATABASE_URL: "postgres://heat:s3cret-pw@127.0.0.1:1/heat" },
      { out: () => {} }
    ).catch((e) => e);
    expect(err.code).toBe("HEAT_E_DB_UNREACHABLE");
    expect(err.cause).toContain("127.0.0.1:1");
    expect(err.cause).not.toContain("s3cret-pw");
  });

  it("fails `token` with HEAT_E_ADMIN_TOKEN_STORE before the first start", async () => {
    await expect(runServer(["token"], sqliteEnv(), { out: () => {} })).rejects.toMatchObject({
      code: "HEAT_E_ADMIN_TOKEN_STORE"
    });
  });

  it("rejects unknown commands with HEAT_E_SERVER_COMMAND", async () => {
    await expect(runServer(["frobnicate"], sqliteEnv(), { out: () => {} })).rejects.toMatchObject({
      code: "HEAT_E_SERVER_COMMAND"
    });
  });
});
