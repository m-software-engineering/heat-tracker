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
    'Collector responses wrap it as `{ "error": HeatError }`. The top-level `code`, `message`, `requestId`, and',
    "`details` fields are deprecated and will be removed in the next minor version; read `error` instead.",
    'Validation errors put per-field messages in `details.fieldErrors` (`{ "<param>": "<message>" }`).',
    ""
  ];
  for (const def of Object.values(getCatalog())) {
    lines.push(`## ${def.code}`, "");
    if ("status" in def) lines.push(`- HTTP status: ${def.status}`, `- Legacy code: \`${def.legacyCode}\``);
    lines.push(`- Message: ${def.message}`, `- Fix: ${def.fix}`, "");
  }
  return lines.join("\n");
};
