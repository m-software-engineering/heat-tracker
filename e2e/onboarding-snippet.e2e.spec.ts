import { test, expect } from "@playwright/test";
import { trackingSnippet } from "../examples/nextjs-dashboard/lib/onboarding";

test.describe("onboarding tracking snippet (#59)", () => {
  test("fills in dashboardOrigins with the dashboard's own origin", () => {
    const snippet = trackingSnippet("https://collector.example.com", "pk_abc", "https://heat.example.com");
    expect(snippet).toContain('dashboardOrigins: ["https://heat.example.com"]');
    expect(snippet).toContain('endpoint: "https://collector.example.com/ingest"');
    expect(snippet).toContain('projectKey: "pk_abc"');
  });

  test("escapes values with JSON.stringify and cannot close the script tag", () => {
    const snippet = trackingSnippet('https://c.test/"x', "pk_1", 'https://d.test"</script><script>alert(1)//');
    expect(snippet).toContain('endpoint: "https://c.test/\\"x/ingest"');
    expect(snippet).toContain('dashboardOrigins: ["https://d.test\\"\\u003c/script>\\u003cscript>alert(1)//"]');
    // Only the snippet's own closing tag remains.
    expect(snippet.match(/<\/script>/g)).toHaveLength(1);
    // Each value is a JSON literal, so it parses back to the original string.
    const origins = JSON.parse(snippet.match(/dashboardOrigins: (\[.*\])/)![1]) as string[];
    expect(origins).toEqual(['https://d.test"</script><script>alert(1)//']);
    expect(JSON.parse(snippet.match(/endpoint: (".*"),/)![1])).toBe('https://c.test/"x/ingest');
  });
});
