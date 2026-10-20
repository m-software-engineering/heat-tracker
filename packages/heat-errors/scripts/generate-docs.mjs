import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderErrorsMarkdown } from "../dist/index.mjs";

/** Regenerates docs/errors.md from the built catalog; the unit test fails when it is stale. */
const target = fileURLToPath(new URL("../../../docs/errors.md", import.meta.url));
writeFileSync(target, renderErrorsMarkdown());
