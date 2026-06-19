#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const workspacePackageManifests = ["packages/heat-sdk/package.json", "packages/heat-collector/package.json"];
const coverageMetrics = ["lines", "statements", "branches", "functions"];

/**
 * Parses command-line flags passed as `--name value` or boolean `--name`.
 * @param {string[]} args CLI arguments after the command name.
 * @returns {Record<string, string>} Parsed flag values.
 */
function parseFlags(args) {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = "true";
    }
  }

  return flags;
}

/**
 * Reads a JSON file and returns null when the file is unavailable or malformed.
 * @param {string} filePath Absolute or workspace-relative JSON path.
 * @returns {unknown | null} Parsed JSON payload.
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Returns all files below a root that match the supplied predicate.
 * @param {string} root Directory to search.
 * @param {(filePath: string) => boolean} predicate File matcher.
 * @returns {string[]} Matching file paths.
 */
function findFiles(root, predicate) {
  const files = [];
  if (!existsSync(root)) return files;

  /**
   * Recursively walks a directory without following symlinked directories.
   * @param {string} directory Directory being walked.
   */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && predicate(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

/**
 * Escapes Markdown table control characters in a cell value.
 * @param {unknown} value Cell value.
 * @returns {string} Safe table cell text.
 */
function tableCell(value) {
  return String(value ?? "N/A")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>");
}

/**
 * Renders a GitHub-flavored Markdown table.
 * @param {string[]} headers Table headers.
 * @param {unknown[][]} rows Table rows.
 * @returns {string} Markdown table.
 */
function markdownTable(headers, rows) {
  const header = `| ${headers.map(tableCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

/**
 * Converts a GitHub step outcome into a concise display value.
 * @param {unknown} outcome Raw outcome value.
 * @returns {string} Display label.
 */
function formatOutcome(outcome) {
  const normalized = String(outcome || "unknown").toLowerCase();

  if (normalized === "success") return "Pass";
  if (normalized === "failure") return "Fail";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "skipped") return "Skipped";

  return "Unknown";
}

/**
 * Formats a coverage metric as percent plus covered/total counts.
 * @param {unknown} metric Coverage summary metric object.
 * @returns {string} Display text.
 */
function formatCoverageMetric(metric) {
  if (!metric || typeof metric !== "object") return "N/A";

  const pct = "pct" in metric ? metric.pct : undefined;
  const covered = "covered" in metric ? metric.covered : undefined;
  const total = "total" in metric ? metric.total : undefined;

  if (typeof pct !== "number") return "N/A";
  if (typeof covered === "number" && typeof total === "number") {
    return `${pct.toFixed(2)}% (${covered}/${total})`;
  }

  return `${pct.toFixed(2)}%`;
}

/**
 * Infers the Node matrix version from an artifact path.
 * @param {string} filePath Artifact file path.
 * @returns {string} Node version or local fallback.
 */
function inferNodeVersion(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  const match = normalized.match(/reports-node-(\d+)/);
  return match ? match[1] : "local";
}

/**
 * Infers a workspace package id from a coverage path.
 * @param {string} filePath Coverage summary path.
 * @returns {string} Package id.
 */
function inferPackageId(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  const match = normalized.match(/packages\/([^/]+)\/coverage\/coverage-summary\.json$/);
  return match ? match[1] : "unknown";
}

/**
 * Reads package names and versions for the published workspace packages.
 * @returns {{ id: string; name: string; version: string }[]} Package metadata.
 */
function readWorkspacePackages() {
  return workspacePackageManifests.map((manifestPath) => {
    const manifest = readJsonFile(manifestPath);
    const id = path.basename(path.dirname(manifestPath));

    if (!manifest || typeof manifest !== "object") {
      return { id, name: id, version: "unknown" };
    }

    return {
      id,
      name: typeof manifest.name === "string" ? manifest.name : id,
      version: typeof manifest.version === "string" ? manifest.version : "unknown"
    };
  });
}

/**
 * Reads CI metadata files emitted by each matrix lane.
 * @param {string} artifactRoot Downloaded artifact root.
 * @returns {{ node: string; command: string; outcome: string; e2e: string }[]} Matrix metadata rows.
 */
function readCiMetadata(artifactRoot) {
  return findFiles(artifactRoot, (filePath) => /node-\d+\.json$/.test(filePath))
    .map((filePath) => readJsonFile(filePath))
    .filter((metadata) => metadata && typeof metadata === "object")
    .map((metadata) => ({
      node: typeof metadata.node === "string" ? metadata.node : "unknown",
      command: typeof metadata.command === "string" ? metadata.command : "unknown",
      outcome: typeof metadata.outcome === "string" ? metadata.outcome : "unknown",
      e2e: metadata.e2e === true || metadata.e2e === "true" ? "yes" : "no"
    }))
    .sort((left, right) => Number(left.node) - Number(right.node));
}

/**
 * Reads Vitest coverage summary artifacts.
 * @param {string} artifactRoot Downloaded artifact root.
 * @param {{ id: string; name: string; version: string }[]} packages Workspace packages.
 * @returns {unknown[][]} Coverage table rows.
 */
function readCoverageRows(artifactRoot, packages) {
  const packageNames = new Map(packages.map((workspacePackage) => [workspacePackage.id, workspacePackage.name]));

  return findFiles(artifactRoot, (filePath) => filePath.endsWith("coverage-summary.json"))
    .map((filePath) => {
      const summary = readJsonFile(filePath);
      const total = summary && typeof summary === "object" && "total" in summary ? summary.total : null;
      const packageId = inferPackageId(filePath);

      return [
        inferNodeVersion(filePath),
        packageNames.get(packageId) || packageId,
        ...coverageMetrics.map((metric) =>
          total && typeof total === "object" && metric in total ? formatCoverageMetric(total[metric]) : "N/A"
        )
      ];
    })
    .sort((left, right) => {
      const nodeDiff = Number(left[0]) - Number(right[0]);
      return nodeDiff === 0 ? String(left[1]).localeCompare(String(right[1])) : nodeDiff;
    });
}

/**
 * Parses XML attributes from a single tag.
 * @param {string} attributeText Raw tag attribute text.
 * @returns {Record<string, string>} Parsed attributes.
 */
function parseXmlAttributes(attributeText) {
  const attributes = {};

  for (const match of attributeText.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

/**
 * Parses Playwright JUnit summary numbers.
 * @param {string} xml JUnit XML content.
 * @returns {{ tests: number; failures: number; errors: number; skipped: number; time: number } | null} Summary.
 */
function parseJunitSummary(xml) {
  const testsuitesMatch = xml.match(/<testsuites\b([^>]*)>/);
  if (testsuitesMatch) {
    const attributes = parseXmlAttributes(testsuitesMatch[1]);
    return {
      tests: Number(attributes.tests || 0),
      failures: Number(attributes.failures || 0),
      errors: Number(attributes.errors || 0),
      skipped: Number(attributes.skipped || 0),
      time: Number(attributes.time || 0)
    };
  }

  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  for (const match of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const attributes = parseXmlAttributes(match[1]);
    totals.tests += Number(attributes.tests || 0);
    totals.failures += Number(attributes.failures || 0);
    totals.errors += Number(attributes.errors || 0);
    totals.skipped += Number(attributes.skipped || 0);
    totals.time += Number(attributes.time || 0);
  }

  return totals.tests > 0 ? totals : null;
}

/**
 * Reads the preferred Playwright JUnit artifact, favoring the Node 22 E2E lane.
 * @param {string} artifactRoot Downloaded artifact root.
 * @returns {{ source: string; tests: number; failures: number; errors: number; skipped: number; time: number } | null} E2E summary.
 */
function readE2eSummary(artifactRoot) {
  const files = findFiles(artifactRoot, (filePath) => filePath.endsWith("e2e-junit.xml"));
  const preferred = files.find((filePath) => inferNodeVersion(filePath) === "22") || files[0];
  if (!preferred) return null;

  const summary = parseJunitSummary(readFileSync(preferred, "utf8"));
  return summary ? { source: preferred, ...summary } : null;
}

/**
 * Reads GitHub Actions runtime context and PR metadata.
 * @returns {{ repository: string; runId: string; eventName: string; sha: string; ref: string; pr: string }} Context.
 */
function readGithubContext() {
  const event = process.env.GITHUB_EVENT_PATH ? readJsonFile(process.env.GITHUB_EVENT_PATH) : null;
  const pullRequest = event && typeof event === "object" && "pull_request" in event ? event.pull_request : null;

  return {
    repository: process.env.GITHUB_REPOSITORY || "local",
    runId: process.env.GITHUB_RUN_ID || "local",
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    sha: process.env.GITHUB_SHA || "local",
    ref: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "local",
    pr: pullRequest && typeof pullRequest === "object" && "number" in pullRequest ? `#${pullRequest.number}` : "N/A"
  };
}

/**
 * Renders shared GitHub context rows.
 * @param {ReturnType<typeof readGithubContext>} context GitHub context.
 * @returns {string} Markdown table.
 */
function renderContextTable(context) {
  const run =
    context.repository !== "local" && context.runId !== "local"
      ? `[${context.runId}](https://github.com/${context.repository}/actions/runs/${context.runId})`
      : context.runId;

  return markdownTable(
    ["Field", "Value"],
    [
      ["Repository", context.repository],
      ["Run", run],
      ["Event", context.eventName],
      ["Ref", context.ref],
      ["PR", context.pr],
      ["SHA", context.sha === "local" ? context.sha : context.sha.slice(0, 12)]
    ]
  );
}

/**
 * Renders the CI job summary from downloaded artifacts.
 * @param {Record<string, string>} flags CLI flags.
 * @returns {string} Markdown summary.
 */
function renderCiSummary(flags) {
  const artifactRoot = path.resolve(flags.artifacts || ".github-summary-artifacts");
  const packages = readWorkspacePackages();
  const metadata = readCiMetadata(artifactRoot);
  const coverageRows = readCoverageRows(artifactRoot, packages);
  const e2e = readE2eSummary(artifactRoot);
  const context = readGithubContext();
  const needsResult = process.env.VERIFY_RESULT || "unknown";

  const gateRows = metadata.length
    ? metadata.map((row) => [row.node, row.command, formatOutcome(row.outcome), row.e2e])
    : [["N/A", "No CI metadata artifact found", formatOutcome(needsResult), "N/A"]];

  const e2eRows = e2e
    ? [["Playwright Chromium", e2e.tests, e2e.failures, e2e.errors, e2e.skipped, `${e2e.time.toFixed(2)}s`]]
    : [["Playwright Chromium", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable"]];

  const packageRows = packages.map((workspacePackage) => [
    workspacePackage.name,
    workspacePackage.version,
    `packages/${workspacePackage.id}`
  ]);

  return [
    "# CI Quality Summary",
    "",
    renderContextTable(context),
    "",
    "## Harness Gates",
    "",
    "The existing `pnpm verify` commands remain the source of truth; this summary only reads their artifacts.",
    "",
    markdownTable(["Node", "Command", "Result", "E2E"], gateRows),
    "",
    "## Coverage",
    "",
    coverageRows.length
      ? markdownTable(["Node", "Package", "Lines", "Statements", "Branches", "Functions"], coverageRows)
      : markdownTable(
          ["Node", "Package", "Lines", "Statements", "Branches", "Functions"],
          [["N/A", "Coverage artifact unavailable", "N/A", "N/A", "N/A", "N/A"]]
        ),
    "",
    "## E2E",
    "",
    markdownTable(["Suite", "Tests", "Failures", "Errors", "Skipped", "Duration"], e2eRows),
    "",
    "## Package Versions",
    "",
    markdownTable(["Package", "Version", "Path"], packageRows)
  ].join("\n");
}

/**
 * Parses the Changesets publishedPackages output.
 * @param {string} raw Raw JSON output.
 * @returns {{ name: string; version: string }[]} Published packages.
 */
function parsePublishedPackages(raw) {
  const parsed = raw ? readJsonString(raw) : null;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "unknown",
      version: typeof entry.version === "string" ? entry.version : "unknown"
    }));
}

/**
 * Parses a JSON string and returns null when it is invalid.
 * @param {string} raw JSON string.
 * @returns {unknown | null} Parsed JSON.
 */
function readJsonString(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Builds an npm package version URL for a package.
 * @param {string} name Package name.
 * @param {string} version Package version.
 * @returns {string} npm package URL.
 */
function npmVersionUrl(name, version) {
  return `https://www.npmjs.com/package/${name}/v/${version}`;
}

/**
 * Renders the CD job summary from Changesets outputs and package metadata.
 * @returns {string} Markdown summary.
 */
function renderCdSummary() {
  const context = readGithubContext();
  const packages = readWorkspacePackages();
  const buildOutcome = process.env.BUILD_OUTCOME || "unknown";
  const changesetsOutcome = process.env.CHANGESETS_OUTCOME || "unknown";
  const published = process.env.CHANGESETS_PUBLISHED || "false";
  const hasChangesets = process.env.CHANGESETS_HAS_CHANGESETS || "unknown";
  const publishedPackages = parsePublishedPackages(process.env.CHANGESETS_PUBLISHED_PACKAGES || "");

  const releaseRows = [
    ["Build", formatOutcome(buildOutcome)],
    ["Changesets", formatOutcome(changesetsOutcome)],
    ["Published to registry", published === "true" ? "Yes" : "No"],
    ["Open changesets detected", hasChangesets === "true" ? "Yes" : hasChangesets === "false" ? "No" : "Unknown"]
  ];

  const packageRows = packages.map((workspacePackage) => [
    workspacePackage.name,
    workspacePackage.version,
    `packages/${workspacePackage.id}`
  ]);

  const publishedRows = publishedPackages.length
    ? publishedPackages.map((workspacePackage) => [
        workspacePackage.name,
        workspacePackage.version,
        `[npm](${npmVersionUrl(workspacePackage.name, workspacePackage.version)})`
      ])
    : [["No package publish reported", "N/A", "N/A"]];

  return [
    "# CD Release Summary",
    "",
    renderContextTable(context),
    "",
    "## Release Gates",
    "",
    markdownTable(["Gate", "Result"], releaseRows),
    "",
    "## Current Package Versions",
    "",
    markdownTable(["Package", "Version", "Path"], packageRows),
    "",
    "## Published Packages",
    "",
    markdownTable(["Package", "Version", "Registry"], publishedRows)
  ].join("\n");
}

/**
 * Writes Markdown to the selected output file or stdout.
 * @param {string} markdown Markdown content.
 * @param {string | undefined} outputPath Explicit output file.
 */
function writeSummary(markdown, outputPath) {
  if (outputPath) {
    writeFileSync(outputPath, `${markdown}\n`, "utf8");
    return;
  }

  process.stdout.write(`${markdown}\n`);
}

/**
 * Dispatches the summary command requested by the CLI.
 */
function main() {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const outputPath = flags.output || process.env.GITHUB_STEP_SUMMARY;

  if (command === "ci") {
    writeSummary(renderCiSummary(flags), outputPath);
    return;
  }

  if (command === "cd") {
    writeSummary(renderCdSummary(), outputPath);
    return;
  }

  process.stderr.write("Usage: node scripts/github-summary.mjs <ci|cd> [--artifacts <dir>] [--output <file>]\n");
  process.exitCode = 1;
}

main();
