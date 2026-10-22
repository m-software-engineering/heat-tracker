import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { clickBatch } from "./fixtures/ingest-payload";

/**
 * Runs the README quick start against the real compose stack built from this checkout
 * (docker-compose.yml + compose.dev.yml). Opt-in, because it needs Docker:
 *   docker compose -f docker-compose.yml -f compose.dev.yml build
 *   HEAT_COMPOSE_E2E=1 pnpm exec playwright test e2e/compose.e2e.spec.ts
 * CI runs it in .github/workflows/compose-smoke.yml.
 */
const enabled = process.env.HEAT_COMPOSE_E2E === "1";
const ROOT = path.resolve(__dirname, "..");
const PROJECT = "heat-tracker-e2e";
const COLD_START_BUDGET_MS = 120_000;

const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", "-p", PROJECT, "-f", "docker-compose.yml", "-f", "compose.dev.yml", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

test.describe("docker compose quick start", () => {
  test.skip(!enabled, "set HEAT_COMPOSE_E2E=1 (needs Docker and built images)");
  test.describe.configure({ timeout: 300_000 });

  test.afterAll(() => {
    if (enabled) compose("down", "-v");
  });

  test("cold start, paste token, copy snippet, first event, data survives down/up", async ({ page }) => {
    const started = Date.now();
    compose("up", "-d", "--wait", "--wait-timeout", "120");
    const coldStartMs = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(`compose cold start: ${coldStartMs} ms`);
    expect(coldStartMs).toBeLessThanOrEqual(COLD_START_BUDGET_MS);

    const logs = compose("logs", "collector");
    expect(logs).toContain("docker compose exec collector heat-collector token");
    const token = compose("exec", "-T", "collector", "heat-collector", "token").trim();
    expect(logs).toContain(token);

    const unauthorized = await fetch("http://localhost:4000/api/metrics");
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error.code).toBe("HEAT_E_ADMIN_TOKEN_MISSING");

    await page.goto("http://localhost:3000/");
    await page.getByLabel("Admin token").fill(token);
    await page.getByRole("button", { name: "Continue" }).click();
    // #29 flow: empty projects → "Create project" → name ("My site") → "Create" → snippet screen.
    await page.getByRole("link", { name: "Create project" }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("ingest-status")).toHaveText(
      "Waiting for your first event… Open your site in another tab."
    );
    expect(await page.evaluate(() => document.cookie)).not.toContain("heat_admin");

    const snippet = await page.getByTestId("snippet").innerText();
    const projectKey = snippet.match(/projectKey: "([^"]+)"/)![1];
    expect(snippet).toContain('endpoint: "http://localhost:4000/ingest"');

    const ingest = await fetch("http://localhost:4000/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-project-key": projectKey, origin: "https://shop.example.com" },
      body: JSON.stringify(clickBatch())
    });
    expect(ingest.status).toBe(200);
    await expect(page.getByTestId("ingest-status")).toHaveText("✓ Receiving events. Open your pages", {
      timeout: 10_000
    });

    compose("down");
    compose("up", "-d", "--wait", "--wait-timeout", "120");
    expect(compose("exec", "-T", "collector", "heat-collector", "token").trim()).toBe(token);
    const project = await fetch(`http://localhost:4000/api/projects/by-key/${projectKey}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect((await project.json()).project.name).toBe("https://shop.example.com");
  });
});
