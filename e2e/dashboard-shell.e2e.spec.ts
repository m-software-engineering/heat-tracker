import { test, expect, type Page } from "@playwright/test";
import { startOverlayStack } from "./fixtures/dashboard-server";
import { COPY, fill, pagesEmptyText, pickLocale } from "../examples/nextjs-dashboard/lib/copy";
import { lastProject, rememberProject } from "../examples/nextjs-dashboard/lib/last-project";
import { errorDetails } from "../examples/nextjs-dashboard/components/ErrorPanel";

// Dashboard shell (#29): spec copy in both locales, live check timing, error panel, a11y.
type Stack = Awaited<ReturnType<typeof startOverlayStack>>;
let stack: Stack;

test.beforeAll(async () => {
  stack = await startOverlayStack();
});

test.afterAll(async () => {
  await stack?.close();
});

const open = async (page: Page, state: string, lang = "en") => {
  await page.goto(`${stack.dashboardUrl}/?shell=${state}&lang=${lang}`);
  await expect(page.locator("h1")).toHaveCount(1);
};

const seriousViolations = async (page: Page) => {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((v: any) => v.impact === "serious" || v.impact === "critical")
      .map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(" ")).join(", ")}`);
  });
};

test("locale: PT-BR only when the browser language starts with pt", () => {
  expect(pickLocale("pt-BR")).toBe("pt-BR");
  expect(pickLocale("pt")).toBe("pt-BR");
  expect(pickLocale("PT-pt")).toBe("pt-BR");
  expect(pickLocale("en-US")).toBe("en");
  expect(pickLocale("es")).toBe("en");
  expect(pickLocale(undefined)).toBe("en");
});

test("copy has no 'events', 'ingest' or 'bucket' outside the snippet screen's 'first event'", () => {
  for (const copy of Object.values(COPY)) {
    for (const [key, text] of Object.entries(copy)) {
      if (key.startsWith("snippet")) continue;
      expect(text, key).not.toMatch(/events?\b|eventos?\b|ingest|bucket/i);
    }
  }
  expect(COPY["pt-BR"].partial).toBe("Mostrando uma amostra dos dados");
  expect(fill(COPY.en.unreachable, { url: "http://c" })).toBe(
    "Can't reach the collector at http://c. Check that it's running."
  );
});

test("pages empty text follows the selected period", () => {
  expect(pagesEmptyText(COPY.en, 7)).toBe("No visits in the last 7 days.");
  expect(pagesEmptyText(COPY.en, 30)).toBe("No visits in the last 30 days.");
  expect(pagesEmptyText(COPY.en, 1)).toBe("No visits in the last 24 hours.");
  expect(pagesEmptyText(COPY["pt-BR"], 90)).toBe("Nenhuma visita nos últimos 90 dias.");
  expect(pagesEmptyText(COPY["pt-BR"], 1)).toBe("Nenhuma visita nas últimas 24 horas.");
});

test("the last-opened project is remembered", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  expect(lastProject(store)).toBeNull();
  rememberProject("p1", "https://shop.example.com", store);
  expect(lastProject(store)).toEqual({ projectId: "p1", site: "https://shop.example.com" });
  map.set("heat-dashboard:lastProject", "{not json");
  expect(lastProject(store)).toBeNull();
});

test("Copy details copies code and requestId, not raw JSON", () => {
  expect(errorDetails({ code: "HEAT_E_X", requestId: "req_1" })).toBe("code: HEAT_E_X\nrequestId: req_1");
});

for (const lang of ["en", "pt"] as const) {
  const copy = COPY[pickLocale(lang)];
  test(`spec copy and roles in ${lang}`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "projects-empty", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.projects);
    await expect(page.getByRole("navigation").getByRole("link")).toHaveText([copy.projects, copy.pages]);
    await expect(page.getByRole("link", { name: copy.skipToContent })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(copy.projectsEmptyTitle);
    await expect(page.getByText(copy.projectsEmptyBody)).toBeVisible();
    await expect(page.getByRole("link", { name: copy.createProject })).toBeVisible();

    await open(page, "unreachable", lang);
    await expect(page.getByRole("alert")).toContainText(fill(copy.unreachable, { url: "http://collector:4000" }));
    await expect(page.getByRole("button", { name: copy.retry })).toBeFocused();

    await open(page, "error", lang);
    const alert = page.getByRole("alert");
    await expect(alert).not.toContainText("{");
    await expect(page.getByRole("button", { name: copy.retry })).toBeFocused();
    await page.getByRole("button", { name: copy.copyDetails }).click();
    await expect(page.getByRole("button", { name: copy.copied })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "code: HEAT_E_DASHBOARD_FETCH\nrequestId: req_e2e"
    );

    await open(page, "sign-in", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.signIn);
    await expect(page.getByLabel(copy.adminToken)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.continue })).toBeVisible();

    await open(page, "new-project", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.newProject);
    await expect(page.getByRole("button", { name: copy.copy, exact: true })).toBeVisible();

    await open(page, "received", lang);
    await expect(page.getByRole("status")).toHaveText(`✓ ${copy.snippetSuccess} ${copy.snippetSuccessLink}`);
  });
}

test("live check: waiting, then 'Still nothing' after 2 min", async ({ page }) => {
  await page.clock.install();
  await open(page, "waiting");
  const status = page.getByRole("status");
  await expect(status).toHaveText(COPY.en.snippetWaiting);
  await page.clock.runFor(119_000);
  await expect(status).toHaveText(COPY.en.snippetWaiting);
  await page.clock.runFor(2_000);
  await expect(status).toHaveText(COPY.en.snippetStill);
});

test("new project: no name field; snippet shows at once; Copy reads Copied for 2 s", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install();
  await open(page, "new-project");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByTestId("snippet")).toContainText("dashboardOrigins: [");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.clock.runFor(2_100);
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});

test("keyboard: Skip to content is the first stop and moves focus to the content", async ({ page }) => {
  await open(page, "sign-in");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#content$/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Admin token")).toBeFocused();
});

test("skeletons carry aria-busy and each state has a unique title", async ({ page }) => {
  await open(page, "loading");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
  await open(page, "new-project");
  await expect(page).toHaveTitle("New project · Heat Tracker");
});

for (const state of [
  "sign-in",
  "unreachable",
  "projects-empty",
  "new-project",
  "waiting",
  "received",
  "error",
  "loading"
]) {
  for (const lang of ["en", "pt"]) {
    test(`axe: 0 serious or critical on ${state} (${lang})`, async ({ page }) => {
      await open(page, state, lang);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
}
