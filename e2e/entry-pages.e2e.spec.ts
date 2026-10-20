import { test, expect, type APIRequestContext } from "@playwright/test";
import { startOverlayStack } from "./fixtures/dashboard-server";

// Entry flow (#25): projects → popular pages by title → heatmap, with no URL typed by hand.
type Stack = Awaited<ReturnType<typeof startOverlayStack>>;
let stack: Stack;

test.beforeAll(async () => {
  stack = await startOverlayStack();
});

test.afterAll(async () => {
  await stack?.close();
});

const ingest = (request: APIRequestContext, sessionId: string, events: Array<Record<string, unknown>>) => {
  const ts = Date.now();
  return request.post(`${stack.siteUrl}/ingest`, {
    headers: { "x-project-key": "overlay-key" },
    data: {
      session: { id: sessionId, startedAt: ts, lastSeenAt: ts },
      events: events.map((event, i) => ({
        eventId: `${sessionId}-${i}`,
        sessionId,
        ts,
        viewport: { w: 1400, h: 900, dpr: 1 },
        device: { ua: "e2e", platform: "e2e", language: "en" },
        ...event
      }))
    }
  });
};

test("a page appears with its title within 10 s of installing the SDK, then opens its heatmap", async ({
  page,
  browser,
  request
}) => {
  // A project that has data but no pageviews yet: the pages screen waits for the first event.
  expect((await ingest(request, "warmup", [{ type: "click", path: "/warmup", x: 1, y: 1 }])).ok()).toBe(true);

  await page.goto(`${stack.dashboardUrl}/`);
  const projects = page.getByTestId("project-list");
  await expect(projects.locator("tbody tr")).toHaveCount(1);
  await expect(projects.getByRole("img", { name: "Receiving data" })).toBeVisible();
  await projects.getByRole("link", { name: /Default/ }).click();

  await expect(page.getByTestId("waiting-first-event")).toContainText("Waiting for your first event…");

  // Install: the fixture site loads the SDK; its pageview carries document.title ("Pricing").
  const started = Date.now();
  const site = await browser.newPage();
  await site.goto(`${stack.siteUrl}/pricing?token=secret&utm_source=ads`);
  const pages = page.getByTestId("popular-pages");
  const row = pages.getByRole("row", { name: /Pricing/ });
  await expect(row).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started, "time until the page is listed").toBeLessThanOrEqual(10_000);
  await expect(page.getByTestId("first-event-received")).toBeVisible();
  await expect(row).toContainText("/pricing");
  await expect(row).not.toContainText("token");
  await site.close();

  // Rows are real links; arrow keys move between them and Enter opens the heatmap.
  const link = pages.getByRole("link", { name: "Pricing" });
  await expect(link).toHaveAttribute("href", /path=%2Fpricing$/);
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/path=%2Fpricing/);
  await expect(page.getByTestId("heatmap-canvas")).toBeAttached();
});

test("long, RTL and emoji titles truncate in one line and keep the full title on hover", async ({ page, request }) => {
  const long = `${"שלום עולם 🔥 价格 ".repeat(12)}end`;
  expect((await ingest(request, "titles", [{ type: "pageview", path: "/long", to: "/long", title: long }])).ok()).toBe(
    true
  );
  expect(
    (await ingest(request, "titles-2", [{ type: "pageview", path: "/long", to: "/long", title: long }])).ok()
  ).toBe(true);

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${stack.dashboardUrl}/`);
  await page.getByTestId("project-list").getByRole("link").first().click();
  const title = page.getByTestId("popular-pages").locator(".entry-title").first();
  await expect(title).toHaveAttribute("title", Array.from(long.replace(/\s+/g, " ").trim()).slice(0, 200).join(""));
  const box = await title.evaluate((el) => ({
    truncated: el.scrollWidth > el.clientWidth,
    overflow: getComputedStyle(el).textOverflow,
    height: el.getBoundingClientRect().height
  }));
  expect(box).toMatchObject({ truncated: true, overflow: "ellipsis" });
  expect(box.height).toBeLessThan(30);

  // ArrowDown moves focus to the next row's link.
  await title.locator("xpath=ancestor::a").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("a.entry-link:focus")).not.toHaveAttribute("href", /path=%2Flong/);
});
