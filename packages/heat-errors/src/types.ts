/** Stable error code. Never renamed or reused without a major release. */
export type HeatErrorCode = `HEAT_E_${string}`;

/** Catalog entry for errors raised inside a process (SDK, CLI, DB setup). They carry no HTTP status. */
export type LocalErrorDefinition<C extends HeatErrorCode = HeatErrorCode> = {
  readonly code: C;
  readonly message: string;
  readonly fix: string;
};

/**
 * Catalog entry for errors the collector returns over HTTP. Status and the deprecated
 * snake_case code are required, so an HTTP error without them cannot be declared.
 */
export type HttpErrorDefinition<C extends HeatErrorCode = HeatErrorCode> = LocalErrorDefinition<C> & {
  readonly status: number;
  /** Deprecated top-level `code`; removed in the next major. */
  readonly legacyCode: string;
  /** Sent as the Retry-After header (seconds) for transient failures. */
  readonly retryAfterSeconds?: number;
};

export type HeatErrorDefinition<C extends HeatErrorCode = HeatErrorCode> =
  | LocalErrorDefinition<C>
  | HttpErrorDefinition<C>;

/** Wire and callback shape shared by SDK, collector, CLI, and DB layer. */
export type HeatError = {
  code: HeatErrorCode;
  /** What went wrong, in one plain sentence. */
  message: string;
  /** The concrete field, value, or limit. Never a raw stack or a secret. */
  cause: string;
  /** Exact action that fixes it. */
  fix: string;
  /** Link to the catalog entry in docs/errors.md. */
  docs: string;
  requestId?: string;
  status?: number;
  /** Stable, documented keys only (for example `fieldErrors`). */
  details?: Record<string, unknown>;
};
