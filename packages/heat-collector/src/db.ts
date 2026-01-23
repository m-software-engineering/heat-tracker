import type { Dialect } from "./schema";
import { buildCreateTableSql, createSchema } from "./schema";

export type DbAdapterConfig =
  | {
      dialect: "pg";
      connectionString?: string;
      client?: any;
      db?: any;
    }
  | {
      dialect: "mysql";
      connectionString?: string;
      client?: any;
      db?: any;
    }
  | {
      dialect: "sqlite";
      file?: string;
      connectionString?: string;
      client?: any;
      db?: any;
    };

export type DbContext = {
  db: any;
  dialect: Dialect;
  schema: ReturnType<typeof createSchema>;
};

export const createDb = async (config: DbAdapterConfig): Promise<DbContext> => {
  const schema = createSchema(config.dialect);

  if (config.db) {
    return { db: config.db, dialect: config.dialect, schema };
  }

  if (config.dialect === "pg") {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    if (!config.client && !config.connectionString) {
      throw new Error("Postgres config requires connectionString or client");
    }
    const client = config.client ?? new Pool({ connectionString: config.connectionString });
    const db = drizzle({ client });
    return { db, dialect: "pg", schema };
  }

  if (config.dialect === "mysql") {
    const { drizzle } = await import("drizzle-orm/mysql2");
    const mysql = await import("mysql2/promise");
    if (!config.client && !config.connectionString) {
      throw new Error("MySQL config requires connectionString or client");
    }
    const client = config.client ?? mysql.createPool(config.connectionString || "");
    const db = drizzle({ client });
    return { db, dialect: "mysql", schema };
  }

  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = await import("better-sqlite3");
  const file = config.file || config.connectionString || "./heat-tracker.db";
  const client = config.client ?? new sqlite.default(file);
  const db = drizzle({ client });
  return { db, dialect: "sqlite", schema };
};

export const autoMigrate = async (ctx: DbContext) => {
  const statements = buildCreateTableSql(ctx.dialect);
  await execute(ctx.db, statements.projects);
  await execute(ctx.db, statements.users);
  await execute(ctx.db, statements.sessions);
  await execute(ctx.db, statements.events);
};

const execute = async (db: any, statement: any) => {
  if (typeof db.execute === "function") {
    return db.execute(statement);
  }
  if (typeof db.run === "function") {
    return db.run(statement);
  }
  if (typeof db.query === "function") {
    return db.query(statement);
  }
  throw new Error("Unsupported db execute method");
};
