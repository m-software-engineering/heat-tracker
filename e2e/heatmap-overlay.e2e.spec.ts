import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { startOverlayStack } from "./fixtures/dashboard-server";

type Stack = Awaited<ReturnType<typeof startOverlayStack>>;
let stack: Stack;
let projectId: string;

const CLICKS = 5;
const MOBILE_CLICKS = 2;

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
  const db = new Database(stack.dbFile);
  projectId = (db.prepare("select id from projects where key = ?").get("overlay-key") as { id: string }).id;
  // A click stored without coordinates (older SDKs), on its own page.
  db.prepare(
    "insert into events (id, project_id, session_id, type, ts, path, meta_json, viewport_bucket) values ('nopos', ?, 's', 'click', ?, '/nopos', '{}', '1400x900')"
  ).run(projectId, Date.now());
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

/** Brightest canvas pixel, in page (screen) coordinates. */
const hotspot = (page: Page) =>
  page.getByTestId("heatmap-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let best = 0;
    let at = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > best) {
        best = data[i];
        at = (i - 3) / 4;
      }
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((at % canvas.width) + 0.5) * (rect.width / canvas.width),
      y: rect.top + (Math.floor(at / canvas.width) + 0.5) * (rect.height / canvas.height),
      scale: rect.width / Number(canvas.style.width.replace("px", ""))
    };
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
  await expect(page.getByTestId("heatmap-summary")).toHaveText(`${CLICKS} clicks · 7 days · desktop`);

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

test("blocked framing shows HEAT_E_FRAME_BLOCKED within 3 s with the exact fix", async ({ page }) => {
  const started = Date.now();
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=/blocked`);
  const alert = page.locator('[data-code="HEAT_E_FRAME_BLOCKED"]');
  await expect(alert).toBeVisible({ timeout: 3000 });
  expect(Date.now() - started).toBeLessThanOrEqual(3000);
  await expect(alert).toContainText(
    `Add \`Content-Security-Policy: frame-ancestors 'self' ${stack.dashboardUrl}\` on your site`
  );
  await expect(alert.getByRole("link")).toHaveAttribute("href", /docs\/errors\.md#heat_e_frame_blocked$/);
  await expect(page.locator("iframe")).toHaveCount(0);
  // Fallback: the heatmap still renders on the blank canvas.
  await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
});

test("empty page says so and names the period", async ({ page }) => {
  await openDashboard(page, "path=/empty");
  await expect(page.getByText("No clicks on this page in the last 7 days.")).toBeVisible();
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
  await expect(group.getByText(`Mobile · ${MOBILE_CLICKS}`)).toBeVisible();
  const tablet = group.getByRole("radio", { name: "Tablet · 0" });
  await expect(tablet).toBeDisabled();
  await expect(group.locator("label", { hasText: "Tablet" })).toHaveAttribute(
    "title",
    "Nenhum evento neste viewport no período"
  );

  await group.getByRole("radio", { name: `Mobile · ${MOBILE_CLICKS}` }).check();
  await expect(page).toHaveURL(/viewport=mobile/);
  await expect(page.getByTestId("heatmap-summary")).toHaveText(`${MOBILE_CLICKS} clicks · 7 days · mobile`);
});

test("an origin outside HEAT_DASHBOARD_SITE_ORIGINS is not loaded and shows the line to add", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=/pricing&site=unlisted`);
  const notice = page.getByTestId("site-not-allowed");
  await expect(notice.getByRole("heading")).toHaveText("Este site ainda não está liberado");
  const origin = stack.siteUrl.replace("127.0.0.1", "localhost");
  await expect(notice.getByTestId("allowlist-line")).toHaveText(`HEAT_DASHBOARD_SITE_ORIGINS=${origin}`);
  await notice.getByRole("button", { name: "Copiar" }).click();
  await expect(notice.getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`HEAT_DASHBOARD_SITE_ORIGINS=${origin}`);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('[data-code="HEAT_E_FRAME_BLOCKED"]')).toHaveCount(0);
  await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
});

test("clicks without a position are reported in a note", async ({ page }) => {
  await openDashboard(page, "path=/nopos");
  await expect(page.getByTestId("no-position-note")).toHaveText("1 cliques sem posição não aparecem no mapa");
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
