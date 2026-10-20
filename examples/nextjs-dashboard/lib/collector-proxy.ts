import { createHeatError, DASHBOARD_ERRORS, QUERY_ERRORS, type HeatError } from "@m-software-engineering/heat-errors";

/** Server-only. The admin token lives in this HttpOnly cookie; browser JS never sees it. */
export const ADMIN_COOKIE = "heat_admin";
const ADMIN_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
const COLLECTOR_TIMEOUT_MS = 5_000;

/** Where the dashboard server reaches the collector (container network in compose). */
export const collectorUrl = () => (process.env.HEAT_COLLECTOR_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Where visitors' browsers reach the collector; goes into the snippet. */
export const publicCollectorUrl = () =>
  (process.env.HEAT_PUBLIC_COLLECTOR_URL || "http://localhost:4000").replace(/\/+$/, "");

export const readAdminToken = (request: Request) => {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ADMIN_COOKIE) return decodeURIComponent(rest.join("=")) || undefined;
  }
  return undefined;
};

const secureFlag = (request: Request) =>
  new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

export const adminCookie = (request: Request, token: string) =>
  [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_S}`,
    ...(secureFlag(request) ? ["Secure"] : [])
  ].join("; ");

export const clearedAdminCookie = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export const unreachableError = (cause: string): HeatError =>
  createHeatError(DASHBOARD_ERRORS.HEAT_E_COLLECTOR_UNREACHABLE, cause, {
    message: `Can't reach the collector at ${collectorUrl()}.`
  });

export const errorResponse = (error: HeatError, status: number) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export const signedOutResponse = () =>
  errorResponse(createHeatError(QUERY_ERRORS.HEAT_E_ADMIN_TOKEN_MISSING, "the dashboard has no admin token yet"), 401);

/**
 * GETs `<collector><path>` with the admin token. Network failure or timeout becomes 502
 * HEAT_E_COLLECTOR_UNREACHABLE; collector responses (including its 401s) pass through.
 */
export const collectorGet = async (path: string, token: string): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(`${collectorUrl()}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS)
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : typeof err;
    const code = (err as { cause?: { code?: unknown } })?.cause?.code;
    return errorResponse(unreachableError(`${name}${typeof code === "string" ? ` ${code}` : ""} for GET ${path}`), 502);
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "x-request-id", "x-result-count", "x-resolved-type", "x-requested-type"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
};
