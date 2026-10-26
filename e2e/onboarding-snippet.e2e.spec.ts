import { test, expect } from "@playwright/test";
import { scriptString, trackingSnippet } from "../examples/nextjs-dashboard/lib/onboarding";
import sdkPackage from "../packages/heat-sdk/package.json";

// The snippet is pasted into an HTML page, so a hostile key or URL must stay one JS string (#64 QA).
const evil = 'x"});fetch("//evil.example")//</script><script>alert(1)</script>\u2028';
const DASHBOARD = "https://heat.example.com";

test.describe("tracking snippet", () => {
  test("pins the CDN import to the heat-sdk package version (#184)", () => {
    expect(trackingSnippet("https://c.example", "k", DASHBOARD)).toContain(`heat-sdk@${sdkPackage.version}/+esm`);
  });

  test("keeps a malicious projectKey, collector URL and dashboard origin as data in an HTML page", async ({ page }) => {
    const snippet = trackingSnippet(`https://c.example${evil}`, evil, `${DASHBOARD}${evil}`);
    // The page as a site owner would paste it, with the CDN import swapped for a recorder.
    const pasted = snippet.replace(/^\s*import .*$/m, "");
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      Object.assign(window, { calls, init: (c: unknown) => calls.push(c), alert: () => calls.push("alert") });
    });
    await page.route("http://snippet.test/", (route) => route.fulfill({ contentType: "text/html", body: pasted }));
    await page.goto("http://snippet.test/");
    await expect
      .poll(() => page.evaluate(() => (window as any).calls))
      .toEqual([
        { endpoint: `https://c.example${evil}/ingest`, projectKey: evil, dashboardOrigins: [`${DASHBOARD}${evil}`] }
      ]);
    // Only the snippet's own tags: nothing inside can close the script element.
    expect(snippet.match(/<\/?script/gi)).toEqual(["<script", "</script"]);
  });

  test("renders a normal key unchanged, with dashboardOrigins set to the dashboard's own origin (#59)", () => {
    expect(trackingSnippet("http://localhost:4000", "pk_ab", "http://localhost:3000")).toContain(
      'init({ endpoint: "http://localhost:4000/ingest", projectKey: "pk_ab", dashboardOrigins: ["http://localhost:3000"] });'
    );
  });

  test("dashboardOrigins goes through scriptString", () => {
    const snippet = trackingSnippet("http://localhost:4000", "pk_ab", 'https://d.test"</script>\u2028');
    expect(snippet).toContain(`dashboardOrigins: [${scriptString('https://d.test"</script>\u2028')}]`);
    expect(snippet).toContain('dashboardOrigins: ["https://d.test\\"\\u003c/script>\\u2028"]');
  });

  test("scriptString round-trips through JSON and never emits <, </script, U+2028 or U+2029", () => {
    for (const value of ["pk_ab", 'a"b\\c', "</script><!--", "x\u2028y\u2029z", "ü🔥\n"]) {
      const literal = scriptString(value);
      expect(JSON.parse(literal)).toBe(value);
      expect(literal).not.toMatch(/[<\u2028\u2029]/);
    }
    expect(scriptString("</script>")).toBe('"\\u003c/script>"');
  });
});
