import { createRequire } from "node:module";

import { createCollector as createEsmCollector } from "@m-software-engineering/heat-collector";

const require = createRequire(import.meta.url);
const { createCollector: createCommonJsCollector } = require("@m-software-engineering/heat-collector");

/** Verifies that a package entrypoint can initialize the SQLite adapter. */
const verifySqliteCollector = async (createCollector) => {
  await createCollector({
    db: { dialect: "sqlite", file: ":memory:" },
    auth: { mode: "projectKey" },
    autoMigrate: false,
    logging: { level: "silent" }
  });
};

await verifySqliteCollector(createEsmCollector);
await verifySqliteCollector(createCommonJsCollector);
