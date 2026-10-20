#!/usr/bin/env node

import { formatHeatError, HeatTrackerError, isHeatError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";
import { migrationFailureCause } from "./cli-errors";
import { runServer } from "./server-main";

// eslint-disable-next-line no-console
const out = (line: string) => console.log(line);

runServer(process.argv.slice(2), process.env, { out }).catch((err) => {
  const heatError = isHeatError(err)
    ? err
    : new HeatTrackerError(
        SERVER_ERRORS.HEAT_E_MIGRATION_FAILED,
        migrationFailureCause(err, {
          dialect: process.env.HEAT_DIALECT || "pg",
          connectionString: process.env.DATABASE_URL,
          file: process.env.SQLITE_FILE
        }),
        { original: err }
      );
  // eslint-disable-next-line no-console
  console.error(formatHeatError(heatError));
  process.exit(1);
});
