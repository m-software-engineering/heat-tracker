import { sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnyMySqlTable } from "drizzle-orm/mysql-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

export type Dialect = "pg" | "mysql" | "sqlite" | "mongodb";

export type Schema = {
  projects: AnyPgTable | AnyMySqlTable | AnySQLiteTable | string;
  users: AnyPgTable | AnyMySqlTable | AnySQLiteTable | string;
  sessions: AnyPgTable | AnyMySqlTable | AnySQLiteTable | string;
  events: AnyPgTable | AnyMySqlTable | AnySQLiteTable | string;
};

export const createSchema = (dialect: Dialect): Schema => {
  if (dialect === "mongodb") {
    return {
      projects: "projects",
      users: "users",
      sessions: "sessions",
      events: "events"
    };
  }

  if (dialect === "pg") {
    const { pgTable, text, bigint, integer, index } = require("drizzle-orm/pg-core");

    const projects = pgTable(
      "projects",
      {
        id: text("id").primaryKey(),
        key: text("key").notNull().unique(),
        name: text("name").notNull(),
        createdAt: bigint("created_at", { mode: "number" }).notNull()
      },
      (table: any) => ({
        keyIdx: index("projects_key_idx").on(table.key)
      })
    );

    const users = pgTable(
      "users",
      {
        id: text("id").primaryKey(),
        projectId: text("project_id").notNull(),
        externalId: text("external_id").notNull(),
        traitsJson: text("traits_json"),
        createdAt: bigint("created_at", { mode: "number" }).notNull()
      },
      (table: any) => ({
        projectExternalIdx: index("users_project_external_idx").on(table.projectId, table.externalId)
      })
    );

    const sessions = pgTable("sessions", {
      id: text("id").primaryKey(),
      projectId: text("project_id").notNull(),
      userId: text("user_id"),
      startedAt: bigint("started_at", { mode: "number" }).notNull(),
      lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
      firstPath: text("first_path").notNull(),
      userAgent: text("user_agent"),
      deviceJson: text("device_json"),
      ipHash: text("ip_hash")
    });

    const events = pgTable(
      "events",
      {
        id: text("id").primaryKey(),
        projectId: text("project_id").notNull(),
        sessionId: text("session_id").notNull(),
        userId: text("user_id"),
        type: text("type").notNull(),
        ts: bigint("ts", { mode: "number" }).notNull(),
        path: text("path").notNull(),
        selector: text("selector"),
        x: integer("x"),
        y: integer("y"),
        scrollDepth: integer("scroll_depth"),
        metaJson: text("meta_json")
      },
      (table: any) => ({
        projectPathTsIdx: index("events_project_path_ts_idx").on(table.projectId, table.path, table.ts),
        sessionTsIdx: index("events_session_ts_idx").on(table.sessionId, table.ts)
      })
    );

    return { projects, users, sessions, events };
  }

  if (dialect === "mysql") {
    const { mysqlTable, text, bigint, int, index } = require("drizzle-orm/mysql-core");

    const projects = mysqlTable(
      "projects",
      {
        id: text("id").primaryKey(),
        key: text("key").notNull().unique(),
        name: text("name").notNull(),
        createdAt: bigint("created_at", { mode: "number" }).notNull()
      },
      (table: any) => ({
        keyIdx: index("projects_key_idx").on(table.key)
      })
    );

    const users = mysqlTable(
      "users",
      {
        id: text("id").primaryKey(),
        projectId: text("project_id").notNull(),
        externalId: text("external_id").notNull(),
        traitsJson: text("traits_json"),
        createdAt: bigint("created_at", { mode: "number" }).notNull()
      },
      (table: any) => ({
        projectExternalIdx: index("users_project_external_idx").on(table.projectId, table.externalId)
      })
    );

    const sessions = mysqlTable("sessions", {
      id: text("id").primaryKey(),
      projectId: text("project_id").notNull(),
      userId: text("user_id"),
      startedAt: bigint("started_at", { mode: "number" }).notNull(),
      lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
      firstPath: text("first_path").notNull(),
      userAgent: text("user_agent"),
      deviceJson: text("device_json"),
      ipHash: text("ip_hash")
    });

    const events = mysqlTable(
      "events",
      {
        id: text("id").primaryKey(),
        projectId: text("project_id").notNull(),
        sessionId: text("session_id").notNull(),
        userId: text("user_id"),
        type: text("type").notNull(),
        ts: bigint("ts", { mode: "number" }).notNull(),
        path: text("path").notNull(),
        selector: text("selector"),
        x: int("x"),
        y: int("y"),
        scrollDepth: int("scroll_depth"),
        metaJson: text("meta_json")
      },
      (table: any) => ({
        projectPathTsIdx: index("events_project_path_ts_idx").on(table.projectId, table.path, table.ts),
        sessionTsIdx: index("events_session_ts_idx").on(table.sessionId, table.ts)
      })
    );

    return { projects, users, sessions, events };
  }

  const { sqliteTable, text, integer, index } = require("drizzle-orm/sqlite-core");

  const projects = sqliteTable(
    "projects",
    {
      id: text("id").primaryKey(),
      key: text("key").notNull(),
      name: text("name").notNull(),
      createdAt: integer("created_at").notNull()
    },
    (table: any) => ({
      keyIdx: index("projects_key_idx").on(table.key)
    })
  );

  const users = sqliteTable(
    "users",
    {
      id: text("id").primaryKey(),
      projectId: text("project_id").notNull(),
      externalId: text("external_id").notNull(),
      traitsJson: text("traits_json"),
      createdAt: integer("created_at").notNull()
    },
    (table: any) => ({
      projectExternalIdx: index("users_project_external_idx").on(table.projectId, table.externalId)
    })
  );

  const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id"),
    startedAt: integer("started_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    firstPath: text("first_path").notNull(),
    userAgent: text("user_agent"),
    deviceJson: text("device_json"),
    ipHash: text("ip_hash")
  });

  const events = sqliteTable(
    "events",
    {
      id: text("id").primaryKey(),
      projectId: text("project_id").notNull(),
      sessionId: text("session_id").notNull(),
      userId: text("user_id"),
      type: text("type").notNull(),
      ts: integer("ts").notNull(),
      path: text("path").notNull(),
      selector: text("selector"),
      x: integer("x"),
      y: integer("y"),
      scrollDepth: integer("scroll_depth"),
      metaJson: text("meta_json")
    },
    (table: any) => ({
      projectPathTsIdx: index("events_project_path_ts_idx").on(table.projectId, table.path, table.ts),
      sessionTsIdx: index("events_session_ts_idx").on(table.sessionId, table.ts)
    })
  );

  return { projects, users, sessions, events };
};

export const buildCreateTableSql = (dialect: Dialect) => {
  if (dialect === "sqlite") {
    return {
      projects: sql`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );`,
      users: sql`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        traits_json TEXT,
        created_at INTEGER NOT NULL
      );`,
      sessions: sql`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT,
        started_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        first_path TEXT NOT NULL,
        user_agent TEXT,
        device_json TEXT,
        ip_hash TEXT
      );`,
      events: sql`CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_id TEXT,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        path TEXT NOT NULL,
        selector TEXT,
        x INTEGER,
        y INTEGER,
        scroll_depth INTEGER,
        meta_json TEXT
      );`
    };
  }

  return {
    projects: sql`CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(64) PRIMARY KEY,
      key VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL
    );`,
    users: sql`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      project_id VARCHAR(64) NOT NULL,
      external_id VARCHAR(255) NOT NULL,
      traits_json TEXT,
      created_at BIGINT NOT NULL
    );`,
    sessions: sql`CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) PRIMARY KEY,
      project_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64),
      started_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      first_path VARCHAR(1024) NOT NULL,
      user_agent TEXT,
      device_json TEXT,
      ip_hash VARCHAR(255)
    );`,
    events: sql`CREATE TABLE IF NOT EXISTS events (
      id VARCHAR(64) PRIMARY KEY,
      project_id VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64),
      type VARCHAR(64) NOT NULL,
      ts BIGINT NOT NULL,
      path VARCHAR(1024) NOT NULL,
      selector TEXT,
      x INT,
      y INT,
      scroll_depth INT,
      meta_json TEXT
    );`
  };
};
