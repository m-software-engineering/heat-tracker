import { test, expect } from "@playwright/test";
import { trackingSnippet } from "../examples/nextjs-dashboard/lib/onboarding";

// The snippet is pasted into an HTML page, so a hostile key or URL must stay one JS string (#64 QA).
const evil = 'x"});fetch("//evil.example")//</script><script>alert(1)</script>\u2028';

test.describe("tracking snippet", () => {
  test("keeps a malicious projectKey and collector URL as data in an HTML page", async ({ page }) => {
    const snippet = trackingSnippet(`https://c.example${evil}`, evil);
    // The page as a site owner would paste it, with the CDN import swapped for a recorder.
    const pasted = snippet.replace(/^\s*import .*$/m, "");
    await page.setContent(
      `<script>window.calls = []; window.init = (c) => calls.push(c); window.alert = () => calls.push("alert");</script>${pasted}`
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).calls))
      .toEqual([{ endpoint: `https://c.example${evil}/ingest`, projectKey: evil }]);
    // Only the snippet's own tags: nothing inside can close the script element.
    expect(snippet.match(/<\/?script/gi)).toEqual(["<script", "</script"]);
  });

  test("renders a normal key unchanged", () => {
    expect(trackingSnippet("http://localhost:4000", "pk_ab")).toContain(
      'init({ endpoint: "http://localhost:4000/ingest", projectKey: "pk_ab" });'
    );
  });
});
