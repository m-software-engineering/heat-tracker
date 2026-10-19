import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against heat-errors source so unit tests do not depend on a prior build.
    alias: {
      "@m-software-engineering/heat-errors": new URL("../heat-errors/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__fixtures__/**"],
      thresholds: {
        branches: 65,
        functions: 75,
        lines: 80,
        statements: 80
      }
    }
  }
});
