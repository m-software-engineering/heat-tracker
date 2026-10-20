type MigrationTarget = {
  dialect: string;
  connectionString?: string;
  file?: string;
  verbose?: boolean;
};

const MASK = "***";

type DriverError = { name?: unknown; code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };

const asDriverError = (err: unknown): DriverError => (err && typeof err === "object" ? (err as DriverError) : {});

const errorClass = (err: unknown) => {
  if (err && typeof err === "object") {
    const ctor = (err as { constructor?: { name?: string } }).constructor?.name;
    if (ctor && ctor !== "Object") return ctor;
    const name = asDriverError(err).name;
    if (typeof name === "string") return name;
  }
  return typeof err;
};

/** Driver code (ECONNREFUSED, 28P01, ER_ACCESS_DENIED_ERROR, …); AggregateError uses its first inner error. */
const errorCode = (err: unknown): string | undefined => {
  const e = asDriverError(err);
  if (typeof e.code === "string" || typeof e.code === "number") return String(e.code);
  if (Array.isArray(e.errors) && e.errors.length > 0) return errorCode(e.errors[0]);
  return undefined;
};

const parseUrl = (connectionString: string) => {
  try {
    return new URL(connectionString);
  } catch {
    return undefined;
  }
};

/** `host:port` only: never user, password, path, or query. */
export const targetHost = ({ dialect, connectionString, file }: MigrationTarget) => {
  if (dialect === "sqlite") return `sqlite file ${file || ":memory:"}`;
  if (!connectionString) return "no DATABASE_URL";
  const url = parseUrl(connectionString);
  if (!url || !url.hostname) return "unparseable DATABASE_URL";
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
};

/** Removes the connection string, its password (raw and decoded), and `password=` pairs. */
export const maskSecrets = (text: string, connectionString?: string) => {
  let out = text;
  if (connectionString) {
    const url = parseUrl(connectionString);
    const secrets = url?.password ? [url.password, decodeURIComponent(url.password)] : [];
    if (url) {
      url.password = url.password ? MASK : "";
      out = out.split(connectionString).join(url.toString());
    }
    for (const secret of secrets) out = out.split(secret).join(MASK);
  }
  return out
    .replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, `$1${MASK}@`)
    .replace(/(password\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s;&,]+)/gi, `$1${MASK}`);
};

/** ORM wrappers (e.g. DrizzleQueryError) keep the driver error in `cause`; report the innermost one. */
const unwrapDriverError = (err: unknown): unknown => {
  let current = err;
  for (let depth = 0; depth < 5; depth += 1) {
    const inner = asDriverError(current).cause;
    if (!inner || typeof inner !== "object") break;
    current = inner;
  }
  return current;
};

/**
 * Cause for HEAT_E_MIGRATION_FAILED: driver error class + code + host. The raw driver message
 * is appended only with --verbose, and always passes through `maskSecrets`.
 */
export const migrationFailureCause = (wrapped: unknown, target: MigrationTarget) => {
  const err = unwrapDriverError(wrapped);
  const code = errorCode(err);
  const base = `${errorClass(err)}${code ? ` ${code}` : ""} (${target.dialect} at ${targetHost(target)})`;
  if (!target.verbose) return base;
  const raw = asDriverError(err).message;
  const message = typeof raw === "string" ? raw : String(err);
  return `${base}: ${maskSecrets(message, target.connectionString)}`;
};
