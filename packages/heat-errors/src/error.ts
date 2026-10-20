import type { HeatError, HeatErrorCode, HeatErrorDefinition } from "./types";

const DOCS_BASE = "https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md";

export const docsUrl = (code: HeatErrorCode) => `${DOCS_BASE}#${code.toLowerCase()}`;

export type HeatErrorExtras = {
  details?: Record<string, unknown>;
  requestId?: string;
  /** Original error. Kept in memory for server-side logs; never serialized. */
  original?: unknown;
  /** Server-only context (URLs, ids) for logs; never serialized. */
  internal?: Record<string, unknown>;
  /** Replaces the catalog message when it must name a runtime value (still one sentence). */
  message?: string;
};

/** Builds the plain `HeatError` object for a catalog entry. */
export const createHeatError = (
  definition: HeatErrorDefinition,
  cause: string,
  extras: Omit<HeatErrorExtras, "original" | "internal"> = {}
): HeatError => ({
  code: definition.code,
  message: extras.message ?? definition.message,
  cause,
  fix: definition.fix,
  docs: docsUrl(definition.code),
  ...("status" in definition ? { status: definition.status } : {}),
  ...(extras.requestId !== undefined ? { requestId: extras.requestId } : {}),
  ...(extras.details !== undefined ? { details: extras.details } : {})
});

/** Throwable form of `HeatError`. `toJSON` drops the original error. */
export class HeatTrackerError extends Error implements HeatError {
  readonly code: HeatErrorCode;
  readonly cause: string;
  readonly fix: string;
  readonly docs: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  readonly original?: unknown;
  readonly internal?: Record<string, unknown>;

  constructor(definition: HeatErrorDefinition, cause: string, extras: HeatErrorExtras = {}) {
    super(extras.message ?? definition.message);
    const plain = createHeatError(definition, cause, extras);
    this.name = "HeatTrackerError";
    this.code = plain.code;
    this.cause = plain.cause;
    this.fix = plain.fix;
    this.docs = plain.docs;
    this.status = plain.status;
    this.requestId = plain.requestId;
    this.details = plain.details;
    Object.defineProperty(this, "original", { value: extras.original, enumerable: false });
    Object.defineProperty(this, "internal", { value: extras.internal, enumerable: false });
  }

  toJSON(): HeatError {
    return toHeatError(this);
  }
}

/** Strips a `HeatTrackerError` (or any `HeatError`) down to the wire shape. */
export const toHeatError = (err: HeatError): HeatError => ({
  code: err.code,
  message: err.message,
  cause: err.cause,
  fix: err.fix,
  docs: err.docs,
  ...(err.status !== undefined ? { status: err.status } : {}),
  ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
  ...(err.details !== undefined ? { details: err.details } : {})
});

export const isHeatError = (value: unknown): value is HeatError => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    v.code.startsWith("HEAT_E_") &&
    typeof v.message === "string" &&
    typeof v.cause === "string" &&
    typeof v.fix === "string" &&
    typeof v.docs === "string"
  );
};

/** One-line human/agent readable form: `CODE: message Cause: … Fix: … Docs: …`. */
export const formatHeatError = (err: HeatError) =>
  `${err.code}: ${err.message} Cause: ${err.cause} Fix: ${err.fix} Docs: ${err.docs}` +
  (err.requestId ? ` Request: ${err.requestId}` : "");
