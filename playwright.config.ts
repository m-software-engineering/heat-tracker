import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const macosChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.CI && existsSync(macosChromePath) ? macosChromePath : undefined);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/e2e-junit.xml" }]
  ],
  use: {
    headless: true,
    ...devices["Desktop Chrome"],
    ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off"
  }
});
