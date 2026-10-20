import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import { HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";
import { envAdminToken, readStoredToken, resolveAdminToken, startupBanner } from "./admin-token";
import { createCollector } from "./collector";
import { createLogger } from "./logger";
import { connectDb, dbConfigFromEnv, type ServerEnv } from "./server-db";

export type ServerIo = { out: (line: string) => void };

const DEFAULT_DATA_DIR = "/data";

/**
 * Browsers send the SDK's JSON batches cross-origin, so `/ingest` answers CORS preflights for any
 * origin. Ingest is still authenticated by projectKey/JWT; the read API sends no CORS headers.
 */
const ingestCors: RequestHandler = (req, res, next) => {
  if (req.path !== "/ingest") return next();
  res.setHeader("Access-Control-Allow-Origin", req.header("origin") || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-project-key, authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};

/** `heat-collector token`: prints the stored (or env) admin token and nothing else. */
const printToken = (env: ServerEnv, io: ServerIo) => {
  const dataDir = env.HEAT_DATA_DIR || DEFAULT_DATA_DIR;
  const token = envAdminToken(env.HEAT_ADMIN_TOKEN) || readStoredToken(dataDir);
  if (!token) {
    throw new HeatTrackerError(
      SERVER_ERRORS.HEAT_E_ADMIN_TOKEN_STORE,
      `no token in ${dataDir}/admin-token yet; start the collector once to generate it`
    );
  }
  io.out(token);
};

/**
 * HEAT_TRUST_PROXY → Express `trust proxy`: `true`/`false`, a hop count, or comma-separated
 * addresses/subnets (`loopback`, `10.0.0.0/8`). Invalid values fail with HEAT_E_SERVER_CONFIG.
 */
export const parseTrustProxy = (raw: string | undefined): boolean | number | string[] | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  try {
    express().set("trust proxy", entries);
  } catch (err) {
    throw new HeatTrackerError(
      SERVER_ERRORS.HEAT_E_SERVER_CONFIG,
      `HEAT_TRUST_PROXY=${JSON.stringify(value)} is not true, false, a hop count, or a list of addresses`,
      { original: err }
    );
  }
  return entries;
};

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];
const logLevel = (raw: string | undefined): LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(raw ?? "") ? (raw as LogLevel) : "warn";

const serve = async (env: ServerEnv, io: ServerIo): Promise<Server> => {
  const trustProxy = parseTrustProxy(env.HEAT_TRUST_PROXY);
  const level = logLevel(env.HEAT_LOG_LEVEL);
  const db = await connectDb(dbConfigFromEnv(env), createLogger(level));
  const { token } = resolveAdminToken(env.HEAT_DATA_DIR || DEFAULT_DATA_DIR, env.HEAT_ADMIN_TOKEN);
  const collector = await createCollector({
    db: { dialect: db.dialect, db: db.db } as any,
    auth: { mode: "projectKey" },
    admin: { token },
    logging: { level }
  });
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy !== undefined) app.set("trust proxy", trustProxy);
  app.use(ingestCors);
  app.use(collector.router);
  app.use(collector.notFoundHandler);
  const port = Number(env.PORT || 4000);
  const host = env.HOST || "0.0.0.0";
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      io.out(
        startupBanner({
          token,
          dashboardUrl: env.HEAT_DASHBOARD_URL || "http://localhost:3000",
          collectorUrl: env.HEAT_PUBLIC_COLLECTOR_URL || `http://localhost:${actualPort}`
        })
      );
      resolve(server);
    });
    server.on("close", () => collector.close());
    server.on("error", (err: NodeJS.ErrnoException) => {
      collector.close();
      const error: Error = new HeatTrackerError(
        SERVER_ERRORS.HEAT_E_SERVER_LISTEN,
        `${err.code ?? err.name} on ${host}:${port}`,
        { original: err }
      );
      reject(error);
    });
  });
};

/** `heat-collector [serve]` starts the server; `heat-collector token` prints the admin token. */
export const runServer = async (argv: string[], env: ServerEnv, io: ServerIo): Promise<Server | undefined> => {
  const command = argv[0] ?? "serve";
  if (command === "serve") return serve(env, io);
  if (command === "token") {
    printToken(env, io);
    return undefined;
  }
  throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_SERVER_COMMAND, `received command ${JSON.stringify(command)}`);
};
