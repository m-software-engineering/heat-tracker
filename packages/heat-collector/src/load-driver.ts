import { HeatTrackerError, SERVER_ERRORS } from "@m-software-engineering/heat-errors";

/** Drivers are optional peers; a missing one becomes HEAT_E_DB_DRIVER_MISSING naming the npm package to install. */
export const loadDriver = async <T>(
  pkg: "pg" | "mysql2" | "mongodb" | "better-sqlite3",
  load: () => Promise<T>
): Promise<T> => {
  try {
    return await load();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : "";
    if (
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      (message.includes(`'${pkg}'`) || message.includes(`'${pkg}/`))
    ) {
      throw new HeatTrackerError(
        SERVER_ERRORS.HEAT_E_DB_DRIVER_MISSING,
        `database driver "${pkg}" is not installed; run: npm install ${pkg}`
      );
    }
    throw error;
  }
};
