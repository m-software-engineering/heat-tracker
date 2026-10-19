#!/usr/bin/env node

import { HeatTrackerError, SERVER_ERRORS, formatHeatError, isHeatError } from "@m-software-engineering/heat-errors";
import { migrationFailureCause } from "./cli-errors";
import { autoMigrate, createDb } from "./db";

const DIALECTS = ["sqlite", "pg", "mysql", "mongodb"] as const;
type CliDialect = (typeof DIALECTS)[number];

const dialectInput = process.env.HEAT_DIALECT || "sqlite";
const connectionString = process.env.DATABASE_URL;
const file = process.env.SQLITE_FILE;
const database = process.env.MONGODB_DATABASE;
const verbose = process.argv.includes("--verbose");

const isDialect = (value: string): value is CliDialect => (DIALECTS as readonly string[]).includes(value);

const run = async () => {
  if (!isDialect(dialectInput)) {
    throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_CLI_DIALECT, `HEAT_DIALECT=${JSON.stringify(dialectInput)}`);
  }
  const ctx = await createDb({
    dialect: dialectInput,
    connectionString,
    file,
    database
  } as any);
  await autoMigrate(ctx);
  // eslint-disable-next-line no-console
  console.log("migrations complete");
};

run().catch((err) => {
  const heatError = isHeatError(err)
    ? err
    : new HeatTrackerError(
        SERVER_ERRORS.HEAT_E_MIGRATION_FAILED,
        migrationFailureCause(err, { dialect: dialectInput, connectionString, file, verbose }),
        { original: err }
      );
  // eslint-disable-next-line no-console
  console.error(formatHeatError(heatError));
  process.exit(1);
});
