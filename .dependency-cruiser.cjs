module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "sdk-must-not-import-server-runtime",
      severity: "error",
      from: { path: "^packages/heat-sdk/src" },
      to: {
        path: "^(packages/heat-collector|node_modules/(express|better-sqlite3|pg|mysql2|mongodb|drizzle-orm)|node:)"
      }
    },
    {
      name: "packages-must-not-import-example-code",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^examples/" }
    },
    {
      name: "examples-should-use-public-package-api",
      severity: "warn",
      from: { path: "^examples/" },
      to: { path: "^packages/.*/src" }
    }
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: {
      path: "node_modules"
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+"
      }
    },
    tsPreCompilationDeps: true
  }
};
