import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { startOverlayStack } from "./fixtures/dashboard-server";

type Stack = Awaited<ReturnType<typeof startOverlayStack>>;
let stack: Stack;
let projectId: string;

const CLICKS = 5;
const MOBILE_CLICKS = 2; // 400x800, plus one 400x900 click: Mobile counts 3

test.beforeAll(async ({ browser }) => {
  stack = await startOverlayStack();
  // Real SDK clicks on the tracked site, at the 1400 px desktop viewport bucket.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const site = await context.newPage();
  await site.goto(`${stack.siteUrl}/pricing`);
  await site.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
  for (let i = 0; i < CLICKS; i += 1) await site.click("#buy");
  await site.evaluate(() => (window as any).__tracker__.flush());
  await site.goto(`${stack.siteUrl}/blocked`);
  await site.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
  await site.click("#buy");
  await site.evaluate(() => (window as any).__tracker__.flush());
  await context.close();
  // Two clicks from a phone-sized viewport: their own bucket, filtered out of the desktop view.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await mobile.goto(`${stack.siteUrl}/pricing`);
  await mobile.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
  for (let i = 0; i < MOBILE_CLICKS; i += 1) await mobile.click("#buy");
  await mobile.evaluate(() => (window as any).__tracker__.flush());
  await phone.close();
  // One click from a taller phone: a second mobile bucket (400x900), smaller than 400x800.
  const tall = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const tallPage = await tall.newPage();
  await tallPage.goto(`${stack.siteUrl}/pricing`);
  await tallPage.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
  await tallPage.click("#buy");
  await tallPage.evaluate(() => (window as any).__tracker__.flush());
  await tall.close();
  const db = new Database(stack.dbFile);
  projectId = (db.prepare("select id from projects where key = ?").get("overlay-key") as { id: string }).id;
  // Clicks stored without coordinates (older SDKs): one on /nopos, twelve on /nopos-many.
  const noPosition = db.prepare(
    "insert into events (id, project_id, session_id, type, ts, path, meta_json, viewport_bucket) values (?, ?, 's', 'click', ?, ?, '{}', '1400x900')"
  );
  noPosition.run("nopos", projectId, Date.now(), "/nopos");
  for (let i = 0; i < 12; i += 1) noPosition.run(`nopos-${i}`, projectId, Date.now(), "/nopos-many");
  db.close();
});

test.afterAll(async () => {
  await stack?.close();
});

const openDashboard = async (page: Page, query: string) => {
  const started = Date.now();
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&${query}`);
  await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
  return Date.now() - started;
};

/** Centre of the brightest canvas area (the core saturates to a plateau), in page (screen) coordinates. */
const hotspot = (page: Page) =>
  page.getByTestId("heatmap-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let best = 0;
    for (let i = 3; i < data.length; i += 4) best = Math.max(best, data[i]);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== best) continue;
      const p = (i - 3) / 4;
      sx += p % canvas.width;
      sy += Math.floor(p / canvas.width);
      n += 1;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (sx / n + 0.5) * (rect.width / canvas.width),
      y: rect.top + (sy / n + 0.5) * (rect.height / canvas.height),
      scale: rect.width / Number(canvas.style.width.replace("px", ""))
    };
  });

/** On-screen CSS px² the heatmap paints clearly: canvas alpha × the canvas's CSS opacity ≥ 50%, as the person sees it. */
const paintedScreenArea = (page: Page) =>
  page.getByTestId("heatmap-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const opacity = Number(getComputedStyle(canvas).opacity);
    let cells = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] / 255) * opacity >= 0.5) cells += 1;
    const cell = canvas.getBoundingClientRect().width / canvas.width;
    return cells * cell * cell;
  });

const buttonCenter = async (page: Page) => {
  const box = await page.frameLocator("iframe").locator("#buy").boundingBox();
  if (!box) throw new Error("button not rendered in the frame");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("heatmap overlays the framed page and stays aligned while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const elapsed = await openDashboard(page, "path=/pricing");
  expect(elapsed, "time to first heatmap").toBeLessThanOrEqual(2000);

  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-scripts");
  await expect(frame).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("heatmap-summary")).toHaveText(`${CLICKS} clicks · Last 7 days · desktop`);

  // Bucket size for a 1400 × 2000 page at resolution 128, in screen px.
  const check = async () => {
    const hot = await hotspot(page);
    const button = await buttonCenter(page);
    const tolerance = (2000 / 128) * hot.scale;
    expect(Math.abs(hot.x - button.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(hot.y - button.y)).toBeLessThanOrEqual(tolerance);
  };
  await check();
  await page.getByTestId("heatmap-scroller").evaluate((el) => el.scrollTo(0, 700));
  await check();
});

test("controls persist in the URL, keyboard works, and the table is the text alternative", async ({ page }) => {
  await openDashboard(page, "path=/pricing");

  await page.keyboard.press("]");
  await expect(page).toHaveURL(/opacity=70/);
  await page.keyboard.press("h");
  await expect(page.getByTestId("heatmap-canvas")).not.toHaveClass(/ready/);
  await expect(page).toHaveURL(/heat=0/);

  await page.reload();
  await expect(page.getByRole("button", { name: "Heatmap (H)" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("slider")).toHaveValue("70");

  const table = page.getByTestId("top-areas");
  await expect(table).toHaveClass(/sr-only/);
  await page.getByRole("button", { name: "Table" }).click();
  await expect(table).not.toHaveClass(/sr-only/);
  await expect(page).toHaveURL(/view=table/);
  await expect(table.locator("tbody tr").first()).toContainText(`${CLICKS}`);
  await expect(table.locator("tbody tr").first()).toContainText("100%");
  await expect(
    page.getByRole("radiogroup", { name: "Viewport" }).or(page.getByRole("group", { name: "Viewport" }))
  ).toBeVisible();
});

test("a frame check that does not answer in time fails closed: no iframe, could-not-verify notice", async ({
  page
}) => {
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=/pricing&check=slow`);
  const alert = page.locator('[data-code="HEAT_E_FRAME_CHECK_UNVERIFIED"]');
  await expect(alert).toBeVisible({ timeout: 4000 });
  await expect(alert).toContainText("could not verify");
  await expect(alert).toContainText("frame check timed out");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
});

test("empty page shows the #29 heatmap empty copy", async ({ page }) => {
  await openDashboard(page, "path=/empty");
  await expect(page.getByText("No clicks for this screen size in this period")).toBeVisible();
});

test("axe finds no serious or critical violations on the heatmap view", async ({ page }) => {
  await openDashboard(page, "path=/pricing");
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((v: any) => v.impact === "serious" || v.impact === "critical")
      .map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(" ")).join(", ")}`);
  });
  expect(violations).toEqual([]);
});

test("renders 100 k points in ≤ 300 ms without a long task over 50 ms", async ({ page }) => {
  await page.goto(stack.dashboardUrl);
  const result = await page.evaluate(() => (window as any).__renderBench(100_000));
  console.log(`render 100k points: ${Math.round(result.ms)} ms, longest task ${Math.round(result.maxLongTaskMs)} ms`);
  expect(result.ms).toBeLessThanOrEqual(300);
  expect(result.maxLongTaskMs).toBeLessThanOrEqual(50);
});

test("viewport toggle filters events, shows counts and disables empty buckets", async ({ page }) => {
  await openDashboard(page, "path=/pricing");
  const group = page.getByRole("group", { name: "Viewport" });
  await expect(group.getByText(`Desktop · ${CLICKS}`)).toBeVisible();
  await expect(group.getByText(`Mobile · ${MOBILE_CLICKS + 1}`)).toBeVisible();
  const tablet = group.getByRole("radio", { name: "Tablet · 0" });
  await expect(tablet).toBeDisabled();
  await expect(group.locator("label", { hasText: "Tablet" })).toHaveAttribute(
    "title",
    "No events for this viewport in this period"
  );
  // The reason is exposed to assistive technology, not only as a tooltip.
  await expect(tablet).toHaveAccessibleDescription("No events for this viewport in this period");
  await expect(group.getByRole("radio", { name: /^Desktop/ })).toHaveAccessibleDescription("");

  await expect(page.getByTestId("frame-scale")).toHaveText(/^1400 px/);
  await group.getByRole("radio", { name: `Mobile · ${MOBILE_CLICKS + 1}` }).check();
  await expect(page).toHaveURL(/viewport=mobile/);
  // The whole class is plotted; the frame keeps the busiest bucket's width.
  await expect(page.getByTestId("heatmap-summary")).toHaveText(`${MOBILE_CLICKS + 1} clicks · Last 7 days · mobile`);
  await expect(page.getByTestId("frame-scale")).toHaveText("400 px");
});

test("an origin outside HEAT_DASHBOARD_SITE_ORIGINS is not loaded and shows the line to add", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=/pricing&site=unlisted`);
  const notice = page.getByTestId("site-not-allowed");
  await expect(notice.getByRole("heading")).toHaveText("This site isn't allowed yet");
  await expect(notice).toContainText("Add its origin to HEAT_DASHBOARD_SITE_ORIGINS and restart the dashboard.");
  const origin = stack.siteUrl.replace("127.0.0.1", "localhost");
  await expect(notice.getByTestId("allowlist-line")).toHaveText(`HEAT_DASHBOARD_SITE_ORIGINS=${origin}`);
  await notice.getByRole("button", { name: "Copy" }).click();
  const copiedAt = Date.now();
  await expect(notice.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 3000 });
  expect(Date.now() - copiedAt).toBeGreaterThanOrEqual(1900);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`HEAT_DASHBOARD_SITE_ORIGINS=${origin}`);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('[data-code="HEAT_E_FRAME_BLOCKED"]')).toHaveCount(0);
  await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
});

test("clicks without a position are reported in a note", async ({ page }) => {
  await openDashboard(page, "path=/nopos");
  await expect(page.getByTestId("no-position-note")).toHaveText("1 click without a position isn't shown");
  await openDashboard(page, "path=/nopos-many");
  await expect(page.getByTestId("no-position-note")).toHaveText("12 clicks without a position aren't shown");
});

test("a container narrower than the bucket scales the frame to fit and labels it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openDashboard(page, "path=/pricing");
  const scroller = page.getByTestId("heatmap-scroller");
  const { clientWidth, scrollWidth } = await scroller.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const percent = Math.floor((clientWidth / 1400) * 100);
  await expect(page.getByTestId("frame-scale")).toHaveText(`1400 px, ${percent}%`);
});

test("#174: a single click reads as at least 24 × 24 screen px at half on-screen alpha at a 44% frame scale", async ({
  page
}) => {
  await page.setViewportSize({ width: 622, height: 800 });
  await openDashboard(page, "path=/blocked");
  await expect(page.getByTestId("heatmap-summary")).toHaveText(/^1 clicks? · Last 7 days · desktop$/);
  await expect(page.getByTestId("frame-scale")).toHaveText("1400 px, 44%");
  // The canvas fades in (opacity 0 → --heat-opacity) after render; poll until it settles.
  await expect.poll(() => paintedScreenArea(page)).toBeGreaterThanOrEqual(24 * 24);
});
