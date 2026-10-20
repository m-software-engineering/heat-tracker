import { DASHBOARD_ERRORS } from "./dashboard";
import { INGEST_ERRORS } from "./ingest";
import { QUERY_ERRORS } from "./query";
import { SDK_ERRORS } from "./sdk";
import { SERVER_ERRORS } from "./server";

export { DASHBOARD_ERRORS, INGEST_ERRORS, QUERY_ERRORS, SDK_ERRORS, SERVER_ERRORS };

type Catalog = typeof SDK_ERRORS &
  typeof INGEST_ERRORS &
  typeof QUERY_ERRORS &
  typeof SERVER_ERRORS &
  typeof DASHBOARD_ERRORS;

export type CatalogCode = keyof Catalog;

/**
 * The full catalog, used for docs generation and tests. A function (not a spread constant)
 * so bundlers can drop the server entries from the SDK build.
 */
export const getCatalog = (): Catalog => ({
  ...SDK_ERRORS,
  ...INGEST_ERRORS,
  ...QUERY_ERRORS,
  ...SERVER_ERRORS,
  ...DASHBOARD_ERRORS
});
