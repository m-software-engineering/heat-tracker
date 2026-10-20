import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { startOverlayStack } from "./fixtures/dashboard-server";

// #59: the dashboard trusts only the SDK's postMessage handshake from the framed page, never the iframe's load event.
type Stack = Awaited<ReturnType<typeof startOverlayStack>>;
let stack: Stack;
let projectId: string;

const NO_RESPONSE =
  "This page didn't respond. Check that the heat-tracker snippet is installed with this dashboard in `dashboardOrigins`, and that the site allows framing.";
const HELLO = "heat-tracker:frame-hello";

test.beforeAll(async ({ browser }) => {
  stack = await startOverlayStack();
  const context = await browser.newContext();
  const site = await context.newPage();
  await site.goto(`${stack.siteUrl}/pricing`);
  await site.waitForFunction(() => typeof (window as any).__tracker__?.flush === "function");
  await site.click("#buy");
  await site.evaluate(() => (window as any).__tracker__.flush());
  await context.close();
  const db = new Database(stack.dbFile);
  projectId = (db.prepare("select id from projects where key = ?").get("overlay-key") as { id: string }).id;
  db.close();
});

test.afterAll(async () => {
  await stack?.close();
});

const warnings = (page: Page) => {
  const lines: string[] = [];
  page.on("console", (msg) => msg.type() === "warning" && lines.push(msg.text()));
  return lines;
};

/** Opens the dashboard on a fake clock, waits for the frame to be waiting for its hello, then jumps 8 s ahead. */
const openAndWait = async (page: Page, query: string, beforeTimeout?: () => Promise<void>) => {
  await page.clock.install();
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&${query}`);
  const section = page.locator("section.page-heatmap");
  await expect(section).toHaveAttribute("data-frame-state", /waiting|ok|redirected/);
  await beforeTimeout?.();
  await page.clock.runFor(8_000);
  return section;
};

const expectNoResponse = async (page: Page, pagePath: string, origin = stack.siteUrl) => {
  const notice = page.getByTestId("frame-no-response");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-code", "HEAT_E_FRAME_NO_RESPONSE");
  await expect(notice.locator("p")).toHaveText(NO_RESPONSE);
  const link = notice.getByRole("link", { name: "Open page in new tab" });
  await expect(link).toHaveAttribute("href", `${origin}${pagePath}`);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("section.page-heatmap")).toHaveAttribute("data-frame-state", "no-response");
};

test.describe("framing headers detected by the server: blocked at once, no 8 s wait", () => {
  for (const [name, pagePath, detail] of [
    ["X-Frame-Options DENY", "/xfo", "X-Frame-Options DENY"],
    ["CSP frame-ancestors 'none'", "/blocked", "Content-Security-Policy frame-ancestors 'none'"]
  ] as const) {
    test(name, async ({ page }) => {
      // Fake clock that is never advanced: the blocked state cannot come from the 8 s handshake timeout.
      await page.clock.install();
      await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=${pagePath}`);
      const alert = page.locator('[data-code="HEAT_E_FRAME_BLOCKED"]');
      await expect(alert).toBeVisible({ timeout: 3000 });
      await expect(alert).toContainText(detail);
      await expect(alert).toContainText(
        `Add \`Content-Security-Policy: frame-ancestors 'self' ${stack.dashboardUrl}\` on your site`
      );
      await expect(page.locator("section.page-heatmap")).toHaveAttribute("data-frame-state", "blocked");
      await expect(page.locator("iframe")).toHaveCount(0);
      await expect(page.getByTestId("frame-no-response")).toHaveCount(0);
      await expect(page.getByTestId("heatmap-canvas")).toHaveClass(/ready/);
    });
  }
});

test.describe("inconclusive cases show the no-response state after 8 s", () => {
  test("a site that times out on the server check", async ({ page }) => {
    const logs = warnings(page);
    await openAndWait(page, "path=/hang", async () => {
      await expect(page.getByTestId("frame-no-response")).toHaveCount(0);
    });
    await expectNoResponse(page, "/hang");
    // The detail goes to devtools only, never into the visible notice.
    await expect.poll(() => logs.join("\n")).toContain("did not answer within");
    await expect(page.getByTestId("frame-no-response")).not.toContainText("did not answer");
  });

  test("an unreachable site", async ({ page }) => {
    await openAndWait(page, "path=/pricing&site=down");
    await expectNoResponse(page, "/pricing", await page.evaluate(() => (window as any).__DOWN_ORIGIN__));
  });

  test("a page whose snippet has no dashboardOrigins sends nothing", async ({ page }) => {
    await openAndWait(page, "path=/no-dashboard-origins");
    await expectNoResponse(page, "/no-dashboard-origins");
  });
});

test("a successful handshake hides the notice and shows the page", async ({ page }) => {
  const section = await openAndWait(page, "path=/pricing", async () => {
    await expect(page.locator("section.page-heatmap")).toHaveAttribute("data-frame-state", "ok");
  });
  await expect(section).toHaveAttribute("data-frame-state", "ok");
  await expect(page.getByTestId("frame-no-response")).toHaveCount(0);
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.getByTestId("heatmap-canvas")).toBeVisible();
});

test("a cross-origin redirect hides the heatmap and names the URL as text", async ({ page }) => {
  await page.goto(`${stack.dashboardUrl}/?project=${projectId}&path=/moved`);
  const notice = page.getByTestId("frame-redirected");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-code", "HEAT_E_FRAME_REDIRECTED");
  await expect(notice).toHaveText(
    `This page redirected to ${stack.otherUrl}/landing. The heatmap is hidden because it wouldn't line up.`
  );
  await expect(page.getByTestId("heatmap-canvas")).toBeHidden();
  await expect(page.getByTestId("frame-no-response")).toHaveCount(0);
});

test.describe("forged handshakes are ignored", () => {
  test("from the dashboard window itself (wrong source)", async ({ page }) => {
    await openAndWait(page, "path=/no-dashboard-origins", async () => {
      // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- test-only forged message, sent to the page itself
      await page.evaluate(([type, href]) => window.postMessage({ type, href }, "*"), [
        HELLO,
        `${stack.siteUrl}/no-dashboard-origins`
      ] as const);
    });
    await expectNoResponse(page, "/no-dashboard-origins");
  });

  test("from another allowlisted frame (wrong source and origin)", async ({ page }) => {
    await openAndWait(page, "path=/no-dashboard-origins", async () => {
      // A sibling frame on another allowlisted origin claims to be the expected page.
      await page.evaluate((src) => {
        const frame = document.createElement("iframe");
        frame.src = src;
        document.body.appendChild(frame);
      }, `${stack.otherUrl}/landing`);
      const findSibling = () => page.frames().find((f) => f.url().startsWith(stack.otherUrl));
      await expect.poll(() => Boolean(findSibling())).toBe(true);
      const sibling = findSibling()!;
      await sibling.waitForLoadState();
      // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- test-only forged message from a sibling frame
      await sibling.evaluate(([type, href]) => window.parent.postMessage({ type, href }, "*"), [
        HELLO,
        `${stack.siteUrl}/no-dashboard-origins`
      ] as const);
    });
    await expectNoResponse(page, "/no-dashboard-origins");
    await expect(page.getByTestId("frame-redirected")).toHaveCount(0);
  });
});

test("the dashboard sends a CSP frame-src restricted to the allowlist, and the browser enforces it", async ({
  page
}) => {
  const res = await page.goto(`${stack.dashboardUrl}/`);
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/^frame-src /);
  expect(csp.split(/\s+/).slice(1)).toEqual(expect.arrayContaining([stack.siteUrl, stack.otherUrl]));
  expect(csp).not.toContain("*");
  // An origin outside the allowlist (localhost instead of 127.0.0.1) is refused by frame-src.
  const violated = await page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective), { once: true });
        const frame = document.createElement("iframe");
        frame.src = src;
        document.body.appendChild(frame);
      }),
    `${stack.siteUrl.replace("127.0.0.1", "localhost")}/pricing`
  );
  expect(violated).toBe("frame-src");
});
