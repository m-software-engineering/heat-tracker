import { HeatTrackerError } from "@m-software-engineering/heat-errors";
import { configuredOrigin } from "./lib/collector-proxy";

/** Runs once at server start: a bad HEAT_DASHBOARD_URL stops the dashboard instead of failing open. */
export function register() {
  try {
    configuredOrigin();
  } catch (error) {
    if (process.env.NEXT_RUNTIME !== "nodejs") throw error;
    if (!(error instanceof HeatTrackerError)) throw error;
    console.error(
      [
        `${error.code}: ${error.message}`,
        `  got:  ${error.cause}`,
        `  fix:  ${error.fix}`,
        `  docs: ${error.docs}`
      ].join("\n")
    );
    process.exit(1);
  }
}
