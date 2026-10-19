import type { Request, Response } from "express";
import type { ZodError } from "zod";
import {
  HeatTrackerError,
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

/** Deprecated top-level fields and their replacements. Removed in the next major. */
export const LEGACY_FIELDS = {
  code: "error.code",
  message: "error.message",
  requestId: "error.requestId",
  details: "error.details"
} as const;

let legacyWarningLogged = false;

/**
 * The collector cannot see which fields a client reads, so it warns once per process, on the
 * first error response that carries the legacy fields. Clients also get a `Deprecation` header.
 */
const warnLegacyFieldsOnce = (logger: Logger) => {
  if (legacyWarningLogged) return;
  legacyWarningLogged = true;
  logger.warn(
    "Error responses still include deprecated top-level code, message, requestId, and details; " +
      "read error.code, error.message, error.requestId, and error.details instead. Removed in the next major version.",
    {
      deprecated: Object.keys(LEGACY_FIELDS),
      replacements: LEGACY_FIELDS,
      removal: "next major version",
      docs: "https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md"
    }
  );
};

/** Test-only: lets each test observe the once-per-process warning. */
export const resetLegacyWarningForTests = () => {
  legacyWarningLogged = false;
};

export const resolveRequestId = (req: Request) => (req as RequestWithContext).requestId || "unknown";

/** Logs code + cause (plus server-only context); never a stack. */
const describeOriginal = (original: unknown): Record<string, unknown> => {
  if (original instanceof HeatTrackerError) {
    return {
      code: original.code,
      cause: original.cause,
      ...original.internal,
      ...(original.original !== undefined ? { inner: describeOriginal(original.original) } : {})
    };
  }
  if (original instanceof Error) {
    const code = (original as { code?: unknown }).code;
    const hasCode = typeof code === "string" || typeof code === "number";
    return { name: original.name, ...(hasCode ? { code: String(code) } : {}) };
  }
  return { type: typeof original };
};

const redactContext = (context: Record<string, unknown>) => ({
  ...context,
  ...(typeof context.projectKey === "string" ? { projectKey: maskProjectKey(context.projectKey) } : {}),
  ...(typeof context.ip === "string" ? { ip: truncateIp(context.ip) } : {})
});

/**
 * Sends `{ error: HeatError }` plus the deprecated top-level `code`/`message`/`requestId`/`details`
 * fields (removed in the next major) and logs the same error server-side.
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
  const headers = {
    ...(definition.retryAfterSeconds !== undefined ? { "Retry-After": String(definition.retryAfterSeconds) } : {}),
    ...options.headers,
    Deprecation: "true",
    Link: '<https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md>; rel="deprecation"'
  };
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  warnLegacyFieldsOnce(logger);

  const error = createHeatError(definition, cause, { requestId: rid, details: options.details });
  const level = options.logLevel || "warn";
  logger[level](definition.message, {
    requestId: rid,
    status: definition.status,
    code: definition.code,
    cause,
    ...redactContext(options.context ?? {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.original !== undefined ? { err: describeOriginal(options.original) } : {})
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
