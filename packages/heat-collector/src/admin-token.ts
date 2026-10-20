import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";

export const TOKEN_FILE_NAME = "admin-token";
export const SHOW_TOKEN_COMMAND = "docker compose exec collector heat-collector token";

/** Minimum length for a HEAT_ADMIN_TOKEN chosen by the operator (generated tokens are 54 chars). */
export const MIN_ADMIN_TOKEN_LENGTH = 32;

export type AdminTokenSource = "env" | "file" | "generated";

const tokenPath = (dataDir: string) => path.join(dataDir, TOKEN_FILE_NAME);

const errnoCode = (err: unknown) => {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : "unknown error";
};

const storeError = (action: string, file: string, err: unknown) =>
  new HeatTrackerError(SERVER_ERRORS.HEAT_E_ADMIN_TOKEN_STORE, `${action} ${file} failed (${errnoCode(err)})`, {
    original: err
  });

/**
 * The stored token, or undefined when none was written yet. A file that exists but holds no token
 * (empty or whitespace, e.g. an interrupted write) is HEAT_E_ADMIN_TOKEN_FILE_INVALID: it is never
 * silently replaced, because the dashboard may still hold the old token.
 */
export const readStoredToken = (dataDir: string): string | undefined => {
  const file = tokenPath(dataDir);
  let value: string;
  try {
    value = readFileSync(file, "utf8").trim();
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return undefined;
    throw storeError("reading", file, err);
  }
  if (!value) {
    throw new HeatTrackerError(SERVER_ERRORS.HEAT_E_ADMIN_TOKEN_FILE_INVALID, `${file} is empty`);
  }
  return value;
};

/** HEAT_ADMIN_TOKEN, trimmed and checked for length; undefined when unset or blank. */
export const envAdminToken = (raw: string | undefined): string | undefined => {
  const token = raw?.trim();
  if (!token) return undefined;
  if (token.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new HeatTrackerError(
      SERVER_ERRORS.HEAT_E_ADMIN_TOKEN_WEAK,
      `HEAT_ADMIN_TOKEN has ${token.length} characters; at least ${MIN_ADMIN_TOKEN_LENGTH} are required`
    );
  }
  return token;
};

/**
 * `HEAT_ADMIN_TOKEN` wins; otherwise the token in `<dataDir>/admin-token`; otherwise a new
 * 32-byte token is generated and written there (mode 0600) so it survives restarts.
 */
export const resolveAdminToken = (
  dataDir: string,
  envToken: string | undefined
): { token: string; source: AdminTokenSource } => {
  const fromEnv = envAdminToken(envToken);
  if (fromEnv) return { token: fromEnv, source: "env" };
  const stored = readStoredToken(dataDir);
  if (stored) return { token: stored, source: "file" };
  const token = `heat_admin_${crypto.randomBytes(32).toString("base64url")}`;
  const file = tokenPath(dataDir);
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${token}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    throw storeError("writing", file, err);
  }
  return { token, source: "generated" };
};

/** The one block a person needs to read at startup. */
export const startupBanner = (opts: { token: string; dashboardUrl: string; collectorUrl: string }) => {
  const lines = [
    "Heat Tracker is ready.",
    "",
    `  Dashboard:    ${opts.dashboardUrl}`,
    `  Collector:    ${opts.collectorUrl}`,
    `  Admin token:  ${opts.token}`,
    "",
    "Paste the admin token in the dashboard once. Show it again with:",
    `  ${SHOW_TOKEN_COMMAND}`
  ];
  const width = Math.max(...lines.map((line) => line.length)) + 4;
  const rule = "=".repeat(width);
  return [rule, ...lines.map((line) => `  ${line}`), rule].join("\n");
};
