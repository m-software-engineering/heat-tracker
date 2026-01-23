import { autoMigrate, createDb } from "./db";

const dialect = (process.env.HEAT_DIALECT || "sqlite") as "sqlite" | "pg" | "mysql";
const connectionString = process.env.DATABASE_URL;
const file = process.env.SQLITE_FILE;

const run = async () => {
  const ctx = await createDb({
    dialect,
    connectionString,
    file
  } as any);
  await autoMigrate(ctx);
  // eslint-disable-next-line no-console
  console.log("migrations complete");
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
