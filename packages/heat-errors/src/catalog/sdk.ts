import type { LocalErrorDefinition } from "../types";

/** Errors raised by the browser SDK. Kept separate so the SDK bundle only pulls these. */
export const SDK_ERRORS = {
  HEAT_E_CONFIG_MISSING: {
    code: "HEAT_E_CONFIG_MISSING",
    /** The SDK replaces this with one naming the missing key(s). */
    message: "init() is missing a required config key.",
    fix: 'Pass both keys: init({ endpoint: "https://collector.example.com/ingest", projectKey: "pk_live_a1b2" }).'
  },
  HEAT_E_NOT_BROWSER: {
    code: "HEAT_E_NOT_BROWSER",
    message: "init() was called outside a browser, for example during server-side rendering.",
    fix: 'Call init() inside useEffect or behind typeof window !== "undefined".'
  },
  HEAT_E_EVENT_TOO_LARGE: {
    code: "HEAT_E_EVENT_TOO_LARGE",
    message: "An event was dropped because it is larger than one request can carry.",
    fix: "Send less data in track() properties; a single event must fit in 60,000 bytes of JSON."
  },
  HEAT_E_EVENTS_DROPPED: {
    code: "HEAT_E_EVENTS_DROPPED",
    message: "Queued events were dropped before delivery.",
    fix: "Allow sessionStorage, free storage space, or send smaller events and flush more often; details.dropped gives the lost count."
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
