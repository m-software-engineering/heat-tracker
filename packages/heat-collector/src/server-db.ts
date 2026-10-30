import { lookup } from "node:dns/promises";
import { sql } from "drizzle-orm";
import { loadDriver } from "./load-driver";
import { createHeatError, HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";
import type { Logger } from "./logger";
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

/**
 * pg emits `error` on the pool when an idle client's connection dies (database restart,
 * `pg_terminate_backend`, network drop). Without a listener Node treats it as an unhandled
 * `error` event and exits. The pool already discards that client and opens a new one on the next
 * query, so logging it is all that is needed.
 */
export const watchPoolErrors = (
  pool: { on: (event: "error", fn: (err: Error) => void) => unknown },
  logger: Logger,
  host: string
) => {
  pool.on("error", (err) => {
    const code = (err as { code?: unknown }).code;
    const error = createHeatError(
      SERVER_ERRORS.HEAT_E_DB_CONNECTION_LOST,
      `${err.name}${typeof code === "string" ? ` ${code}` : ""} on an idle connection to ${host}`
    );
    logger.error(error.message, { code: error.code, cause: error.cause, fix: error.fix });
  });
};

const pgClient = async (connectionString: string, timeoutMs: number, logger: Logger, host: string) => {
  const { Pool } = await loadDriver("pg", () => import("pg"));
  const pool = new Pool({ connectionString, connectionTimeoutMillis: timeoutMs });
  watchPoolErrors(pool, logger, host);
  return pool;
};

/** A host name that does not resolve fails here with ENOTFOUND instead of a later timeout. */
const resolveHost = async (dialect: string, connectionString: string | undefined, host: string, timeoutMs: number) => {
  if (!connectionString) return;
  let hostname: string | undefined;
  try {
    hostname = new URL(connectionString).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return;
  }
  if (!hostname || dialect === "mongodb") return;
  try {
    // A slow resolver is not a failure here; the connect timeout decides.
    let timer: NodeJS.Timeout | undefined;
    const slow = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    });
    await Promise.race([lookup(hostname), slow]).finally(() => clearTimeout(timer));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    throw new HeatTrackerError(
      SERVER_ERRORS.HEAT_E_DB_UNREACHABLE,
      `${typeof code === "string" ? code : "DNS lookup failed"} (${dialect} at ${host}): the host name does not resolve`,
      { original: err }
    );
  }
};

/**
 * Opens the database and runs one round trip, so a wrong host or a stopped database fails at
 * startup with HEAT_E_DB_UNREACHABLE (cause: driver code + host:port, never the password).
 */
export const connectDb = async (config: DbAdapterConfig, logger: Logger, timeoutMs = 5_000): Promise<DbContext> => {
  const connectionString = "connectionString" in config ? config.connectionString : undefined;
  const file = "file" in config ? config.file : undefined;
  const host = targetHost({ dialect: config.dialect, connectionString, file });
  await resolveHost(config.dialect, connectionString, host, timeoutMs);
  try {
    const withClient =
      config.dialect === "pg" && connectionString
        ? { ...config, client: await pgClient(connectionString, timeoutMs, logger, host) }
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
