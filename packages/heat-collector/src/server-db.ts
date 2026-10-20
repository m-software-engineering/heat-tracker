import { sql } from "drizzle-orm";
import { HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";
import { migrationFailureCause, targetHost } from "./cli-errors";
import { createDb, type DbAdapterConfig, type DbContext } from "./db";

const SERVER_DIALECTS = ["pg", "mysql", "sqlite", "mongodb"] as const;
type ServerDialect = (typeof SERVER_DIALECTS)[number];

export type ServerEnv = Record<string, string | undefined>;

/** Reads the database settings from the environment; throws HEAT_E_DB_CONFIG / HEAT_E_CLI_DIALECT. */
export const dbConfigFromEnv = (env: ServerEnv): DbAdapterConfig => {
  const dialect = env.HEAT_DIALECT || "pg";
  if (!(SERVER_DIALECTS as readonly string[]).includes(dialect)) {
    throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_CLI_DIALECT, `HEAT_DIALECT=${JSON.stringify(dialect)}`);
  }
  if (dialect === "sqlite") return { dialect, file: env.SQLITE_FILE };
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_DB_CONFIG, `DATABASE_URL is not set (HEAT_DIALECT=${dialect})`);
  }
  if (dialect === "mongodb") return { dialect, connectionString, database: env.MONGODB_DATABASE };
  return { dialect: dialect as Exclude<ServerDialect, "sqlite" | "mongodb">, connectionString };
};

const ping = async (ctx: DbContext) => {
  if (ctx.dialect === "mongodb") return ctx.db.command({ ping: 1 });
  if (ctx.dialect === "sqlite") return ctx.db.run(sql`select 1`);
  return ctx.db.execute(sql`select 1`);
};

const pgClient = async (connectionString: string, timeoutMs: number) => {
  const { Pool } = await import("pg");
  return new Pool({ connectionString, connectionTimeoutMillis: timeoutMs });
};

/**
 * Opens the database and runs one round trip, so a wrong host or a stopped database fails at
 * startup with HEAT_E_DB_UNREACHABLE (cause: driver code + host:port, never the password).
 */
export const connectDb = async (config: DbAdapterConfig, timeoutMs = 5_000): Promise<DbContext> => {
  const connectionString = "connectionString" in config ? config.connectionString : undefined;
  const file = "file" in config ? config.file : undefined;
  try {
    const withClient =
      config.dialect === "pg" && connectionString
        ? { ...config, client: await pgClient(connectionString, timeoutMs) }
        : config;
    const ctx = await createDb(withClient);
    await ping(ctx);
    return ctx;
  } catch (err) {
    if (err instanceof HeatTrackerError) throw err;
    const target = { dialect: config.dialect, connectionString, file };
    throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_DB_UNREACHABLE, migrationFailureCause(err, target), {
      original: err,
      internal: { host: targetHost(target) }
    });
  }
};
