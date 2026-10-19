import type { Request, Response } from "express";
import type { ZodError } from "zod";
import {
  createHeatError,
  maskProjectKey,
  truncateIp,
  type HttpErrorDefinition
} from "@m-software-engineering/heat-errors";
import type { Logger } from "./logger";

type RequestWithContext = Request & { requestId?: string };

type SendErrorOptions = {
  details?: Record<string, unknown>;
  logLevel?: "warn" | "error";
  /** Server-side log context. `projectKey` and `ip` are masked before logging. */
  context?: Record<string, unknown>;
  /** Original error, logged as `err` and never sent to the client. */
  original?: unknown;
  headers?: Record<string, string>;
};

export const resolveRequestId = (req: Request) => (req as RequestWithContext).requestId || "unknown";

const redactContext = (context: Record<string, unknown>) => ({
  ...context,
  ...(typeof context.projectKey === "string" ? { projectKey: maskProjectKey(context.projectKey) } : {}),
  ...(typeof context.ip === "string" ? { ip: truncateIp(context.ip) } : {})
});

/**
 * Sends `{ error: HeatError }` plus the deprecated top-level `code`/`message`/`requestId`/`details`
 * fields (kept for one minor version) and logs the same error server-side.
 */
export const sendError = (
  logger: Logger,
  req: Request,
  res: Response,
  definition: HttpErrorDefinition,
  cause: string,
  options: SendErrorOptions = {}
) => {
  const rid = resolveRequestId(req);
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    res.setHeader(key, value);
  }

  const error = createHeatError(definition, cause, { requestId: rid, details: options.details });
  const level = options.logLevel || "warn";
  logger[level](definition.message, {
    requestId: rid,
    status: definition.status,
    code: definition.code,
    cause,
    ...redactContext(options.context ?? {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.original !== undefined ? { err: options.original } : {})
  });

  return res.status(definition.status).json({
    error,
    code: definition.legacyCode,
    message: definition.message,
    requestId: rid,
    ...(options.details !== undefined ? { details: options.details } : {})
  });
};

const issuePath = (path: (string | number)[]) => (path.length ? path.join(".") : "(root)");

/** Stable `{ "<path>": "<message>" }` map; first issue per path wins. */
export const fieldErrors = (error: ZodError) => {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issuePath(issue.path);
    out[key] ??= issue.message;
  }
  return out;
};

/** Cause for query validation: names the param, the received value, and the expected format. */
export const queryCause = (error: ZodError, query: Record<string, unknown>) =>
  Object.entries(fieldErrors(error))
    .map(([param, message]) => `${param}: received ${JSON.stringify(query[param] ?? null)} (${message})`)
    .join("; ");

/** Cause for body validation: paths and messages only, never received values. */
export const payloadCause = (error: ZodError) =>
  Object.entries(fieldErrors(error))
    .slice(0, 5)
    .map(([path, message]) => `${path}: ${message}`)
    .join("; ");
