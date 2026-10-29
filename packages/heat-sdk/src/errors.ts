import {
  SDK_ERRORS,
  createHeatError,
  formatHeatError,
  isHeatError,
  type HeatError
} from "@m-software-engineering/heat-errors";

export type ErrorReporting = {
  debug?: boolean;
  onError?: (err: HeatError) => void;
};

export type ReportError = (err: HeatError) => void;

/** Codes already printed in this page load; debug logs each code once. */
const loggedCodes = new Set<string>();

/** Silent unless `debug` or `onError` is set; never throws into the host page. */
export const createErrorReporter = ({ debug, onError }: ErrorReporting): ReportError => {
  return (err) => {
    try {
      onError?.(err);
    } catch {
      // host callback errors must not break the SDK
    }
    if (debug && !loggedCodes.has(err.code)) {
      loggedCodes.add(err.code);
      // eslint-disable-next-line no-console
      console.warn(`heat-sdk: ${formatHeatError(err)}`);
    }
  };
};

/** Prefers the collector's own `HeatError`; falls back to HEAT_E_INGEST_HTTP. */
export const ingestHttpError = async (res: Response): Promise<HeatError> => {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (isHeatError(body?.error)) return body.error;
  } catch {
    // non-JSON body; fall through
  }
  return createHeatError(SDK_ERRORS.HEAT_E_INGEST_HTTP, `collector returned HTTP ${res.status}`, {
    details: { status: res.status }
  });
};

export const ingestNetworkError = (err: unknown) =>
  createHeatError(
    SDK_ERRORS.HEAT_E_INGEST_NETWORK,
    `fetch failed: ${err instanceof Error ? err.message : String(err)}`
  );

export const eventsDroppedError = (dropped: number, cause: string) =>
  createHeatError(SDK_ERRORS.HEAT_E_EVENTS_DROPPED, cause, { details: { dropped } });
