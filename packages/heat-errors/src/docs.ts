import { getCatalog } from "./catalog";

/** Renders docs/errors.md. The repository copy must equal this output (checked in tests). */
export const renderErrorsMarkdown = () => {
  const lines = [
    "# Heat Tracker errors",
    "",
    "<!-- Generated from packages/heat-errors/src/catalog. Run `corepack pnpm -C packages/heat-errors docs:errors`. -->",
    "",
    "Every SDK, collector, CLI, and database error has this shape:",
    "",
    "```ts",
    "type HeatError = {",
    "  code: `HEAT_E_${string}`;",
    "  message: string;",
    "  cause: string;",
    "  fix: string;",
    "  docs: string;",
    "  requestId?: string;",
    "  status?: number;",
    "  details?: Record<string, unknown>;",
    "};",
    "```",
    "",
    'Collector responses wrap it as `{ "error": HeatError }`.',
    'Validation errors put per-field messages in `details.fieldErrors` (`{ "<param>": "<message>" }`).',
    "",
    "## Migrating from legacy fields",
    "",
    "The top-level `code`, `message`, `requestId`, and `details` fields are deprecated and will be removed in the",
    "next major version. While a response still carries them it also sends `Deprecation: true` and a `Link` to this",
    "section, and the collector logs one deprecation warning per process.",
    "",
    "| Deprecated field | Read instead      |",
    "| ---------------- | ----------------- |",
    "| `code`           | `error.code`      |",
    "| `message`        | `error.message`   |",
    "| `requestId`      | `error.requestId` |",
    "| `details`        | `error.details`   |",
    "",
    "Breaking: the old top-level `error` string is gone; `error` is now the object.",
    "",
    "```js",
    "// before",
    'console.log(body.error); // "invalid jwt"',
    "// after",
    'console.log(body.error.message); // "The JWT has expired."',
    "```",
    ""
  ];
  for (const def of Object.values(getCatalog())) {
    lines.push(`## ${def.code}`, "");
    if ("status" in def) {
      lines.push(`- HTTP status: ${def.status}`, `- Legacy code: \`${def.legacyCode}\``);
      if ("retryAfterSeconds" in def) lines.push(`- Retry-After: ${def.retryAfterSeconds} seconds`);
    }
    lines.push(`- Message: ${def.message}`, `- Fix: ${def.fix}`, "");
  }
  return lines.join("\n");
};
