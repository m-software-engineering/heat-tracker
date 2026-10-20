import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { runServer } from "../packages/heat-collector/src/server-main";
import * as session from "../examples/nextjs-dashboard/app/api/session/route";
import { GET as proxyGet } from "../examples/nextjs-dashboard/app/api/collector/[...path]/route";
import { clickBatch } from "./fixtures/ingest-payload";

const DASHBOARD = "http://localhost:3000";
let server: Server;
let collector: string;
let adminToken: string;

test.beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "heat-dash-session-"));
  const lines: string[] = [];
  server = (await runServer(
    [],
    {
      HEAT_DIALECT: "sqlite",
      SQLITE_FILE: path.join(dir, "db.sqlite"),
      HEAT_DATA_DIR: dir,
      PORT: "0",
      HOST: "127.0.0.1"
    },
    { out: (line) => lines.push(line) }
  ))!;
  collector = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminToken = lines.join("\n").match(/Admin token:\s+(\S+)/)![1];
  process.env.HEAT_COLLECTOR_URL = collector;
});

test.afterAll(async () => {
  delete process.env.HEAT_COLLECTOR_URL;
  await new Promise((done) => server.close(done));
});

const post = (token: string) =>
  session.POST(
    new Request(`${DASHBOARD}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    })
  );

const proxy = (pathname: string, cookie?: string) =>
  proxyGet(new Request(`${DASHBOARD}/api/collector/${pathname}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ path: pathname.split("/") })
  });

test("a wrong token is rejected with the collector's HEAT_E_ADMIN_TOKEN_INVALID and sets no cookie", async () => {
  const res = await post("wrong");
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect((await res.json()).error.code).toBe("HEAT_E_ADMIN_TOKEN_INVALID");
});

test("the right token goes into an HttpOnly cookie and never back into the response body", async () => {
  const res = await post(adminToken);
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^heat_admin=/);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(await res.text()).not.toContain(adminToken);
});

test("the proxy adds the token, and the project appears after its first ingest", async () => {
  const cookie = `heat_admin=${encodeURIComponent(adminToken)}`;
  const denied = await proxy("api/projects/by-key/pk_e2e");
  expect(denied.status).toBe(401);
  expect((await denied.json()).error.code).toBe("HEAT_E_ADMIN_TOKEN_MISSING");

  expect(await (await proxy("api/projects/by-key/pk_e2e", cookie)).json()).toEqual({ project: null });
  const ingest = await fetch(`${collector}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-project-key": "pk_e2e", origin: "https://shop.example.com" },
    body: JSON.stringify(clickBatch())
  });
  expect(ingest.status).toBe(200);
  const after = await (await proxy("api/projects/by-key/pk_e2e", cookie)).json();
  expect(after.project.name).toBe("https://shop.example.com");

  expect((await proxy("healthz", cookie)).status).toBe(404);
});

test("an unreachable collector yields the documented message with Retry guidance", async () => {
  process.env.HEAT_COLLECTOR_URL = "http://127.0.0.1:1";
  try {
    const res = await session.GET(new Request(`${DASHBOARD}/api/session`));
    const body = await res.json();
    expect(body.signedIn).toBe(false);
    expect(body.error).toMatchObject({
      code: "HEAT_E_COLLECTOR_UNREACHABLE",
      message: "Can't reach the collector at http://127.0.0.1:1.",
      fix: "Check that the collector container is running: `docker compose ps`."
    });
  } finally {
    process.env.HEAT_COLLECTOR_URL = collector;
  }
});
