import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against heat-errors source so unit tests do not depend on a prior build.
    alias: {
      "@m-software-engineering/heat-errors": fileURLToPath(new URL("../heat-errors/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__fixtures__/**"],
      thresholds: {
        branches: 50,
        functions: 80,
        lines: 70,
        statements: 70
      }
    }
  }
});
