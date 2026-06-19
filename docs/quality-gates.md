# Quality Gates

`pnpm verify` is the single required local harness command for this repository. It runs formatting, type-aware linting, typechecking, builds, coverage, Playwright E2E, dependency analysis, architecture rules, and package publishing checks.

## Required Command

```bash
corepack pnpm verify
```

No implementation task is complete until this command passes, unless the task is explicitly docs-only or a failure is unrelated and documented with the exact command output.

## Gate Breakdown

- `pnpm format:check`: Prettier formatting gate.
- `pnpm lint`: ESLint flat config with typed TypeScript rules and SDK browser-boundary restrictions.
- `pnpm typecheck`: workspace TypeScript checks.
- `pnpm build`: package and example builds.
- `pnpm test:coverage`: Vitest tests with coverage thresholds.
- `pnpm test:e2e`: Playwright browser SDK-to-collector round trips.
- `pnpm check:deps`: Knip unused files, exports, and dependency analysis.
- `pnpm check:arch`: dependency-cruiser package boundary and cycle checks.
- `pnpm check:pkg`: publint, Are The Types Wrong, and API Extractor for published packages.
- `pnpm verify:non-e2e`: CI helper for Node runtime matrix coverage without browser installation; local completion still requires `pnpm verify`.

## CI Artifacts

When CI fails, attach the relevant machine-readable artifacts before handing work back:

- `packages/*/coverage`
- `playwright-report`
- `test-results`
- failing static-analysis logs from Semgrep, GitHub CodeQL default setup, Dependency Review, or OSV Scanner

Run `corepack pnpm exec playwright install --with-deps chromium` in the CI job that executes E2E before `pnpm verify`; local machines may need `corepack pnpm exec playwright install chromium` before running E2E. macOS local runs auto-detect Google Chrome when present; otherwise set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium-compatible browser executable for local-only runs.

CI and CD are intentionally separate: `.github/workflows/ci.yml` verifies pull requests, and `.github/workflows/cd.yml` publishes through Changesets only on pushes to `main` after a merge.
