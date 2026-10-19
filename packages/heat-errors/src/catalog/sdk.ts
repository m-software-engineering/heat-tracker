import type { LocalErrorDefinition } from "../types";

/** Errors raised by the browser SDK. Kept separate so the SDK bundle only pulls these. */
export const SDK_ERRORS = {
  HEAT_E_CONFIG_MISSING: {
    code: "HEAT_E_CONFIG_MISSING",
    message: "init() was called without a required config key.",
    fix: 'Pass both keys: init({ endpoint: "https://collector.example.com/ingest", projectKey: "pk_live_a1b2" }).'
  },
  HEAT_E_NOT_BROWSER: {
    code: "HEAT_E_NOT_BROWSER",
    message: "init() was called outside a browser, for example during server-side rendering.",
    fix: 'Call init() inside useEffect or behind typeof window !== "undefined".'
  },
  HEAT_E_INGEST_HTTP: {
    code: "HEAT_E_INGEST_HTTP",
    message: "The collector rejected an event batch.",
    fix: "Read the collector error code in details.collector; 401 means check projectKey or setAuthToken(), 413 means lower batch.maxEvents."
  },
  HEAT_E_INGEST_NETWORK: {
    code: "HEAT_E_INGEST_NETWORK",
    message: "The SDK could not reach the collector; the batch will be retried.",
    fix: "Check that endpoint is reachable from the browser and allows CORS for x-project-key."
  }
} as const satisfies Record<string, LocalErrorDefinition>;
