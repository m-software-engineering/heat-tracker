import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";

export const TOKEN_FILE_NAME = "admin-token";
export const SHOW_TOKEN_COMMAND = "docker compose exec collector heat-collector token";

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

/** The stored token, or undefined when none was written yet. */
export const readStoredToken = (dataDir: string): string | undefined => {
  const file = tokenPath(dataDir);
  try {
    const value = readFileSync(file, "utf8").trim();
    return value || undefined;
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return undefined;
    throw storeError("reading", file, err);
  }
};

/**
 * `HEAT_ADMIN_TOKEN` wins; otherwise the token in `<dataDir>/admin-token`; otherwise a new
 * 32-byte token is generated and written there (mode 0600) so it survives restarts.
 */
export const resolveAdminToken = (
  dataDir: string,
  envToken: string | undefined
): { token: string; source: AdminTokenSource } => {
  if (envToken?.trim()) return { token: envToken.trim(), source: "env" };
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
