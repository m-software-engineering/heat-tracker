import { configuredOrigin } from "./lib/collector-proxy";

/** Runs once at server start: a bad HEAT_DASHBOARD_URL stops the dashboard instead of failing open. */
export function register() {
  try {
    configuredOrigin();
  } catch (error) {
    if (process.env.NEXT_RUNTIME !== "nodejs") throw error;
    console.error((error as Error).message);
    process.exit(1);
  }
}
