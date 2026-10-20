import { createHeatError, DASHBOARD_ERRORS, QUERY_ERRORS, type HeatError } from "@m-software-engineering/heat-errors";

/**
 * Server-only. The admin token lives in an HttpOnly cookie; browser JS never sees it. Over HTTPS
 * (or with HEAT_DASHBOARD_SECURE_COOKIE=true) it is `__Host-heat_admin` (Secure, Path=/, no
 * Domain, so no subdomain can set or shadow it). Over plain http://localhost the `__Host-` prefix
 * is unavailable in Safari/Firefox, so it is `heat_admin`. Cookies are not isolated by port: other
 * apps served from the same host name (any port) receive the plain-HTTP cookie too.
 */
export const ADMIN_COOKIE = "heat_admin";
export const SECURE_ADMIN_COOKIE = "__Host-heat_admin";
const ADMIN_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
const COLLECTOR_TIMEOUT_MS = 5_000;

/** Where the dashboard server reaches the collector (container network in compose). */
export const collectorUrl = () => (process.env.HEAT_COLLECTOR_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Where visitors' browsers reach the collector; goes into the snippet. */
export const publicCollectorUrl = () =>
  (process.env.HEAT_PUBLIC_COLLECTOR_URL || "http://localhost:4000").replace(/\/+$/, "");

const cookies = (request: Request) => {
  const found = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && !found.has(name)) found.set(name, rest.join("="));
  }
  return found;
};

const decode = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value) || undefined;
  } catch {
    return undefined;
  }
};

/** Secure cookies are only read on secure requests, so a plain-HTTP cookie can't stand in for one. */
export const readAdminToken = (request: Request) => {
  const jar = cookies(request);
  return secureRequest(request) ? decode(jar.get(SECURE_ADMIN_COOKIE)) : decode(jar.get(ADMIN_COOKIE));
};

export const secureRequest = (request: Request) =>
  process.env.HEAT_DASHBOARD_SECURE_COOKIE === "true" ||
  new URL(request.url).protocol === "https:" ||
  request.headers.get("x-forwarded-proto") === "https";

export const adminCookie = (request: Request, token: string) => {
  const secure = secureRequest(request);
  return [
    `${secure ? SECURE_ADMIN_COOKIE : ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_S}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
};

export const clearedAdminCookie = (request: Request) => {
  const secure = secureRequest(request);
  return `${secure ? SECURE_ADMIN_COOKIE : ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
};

/** The dashboard's own origin as the browser sees it (honours a reverse proxy's X-Forwarded-*). */
const ownOrigin = (request: Request) => {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`.toLowerCase();
};

/**
 * Guards state-changing session calls: JSON only (so a cross-site HTML form cannot post it) and an
 * Origin header equal to the dashboard's own origin. Returns an error response, or undefined.
 */
export const rejectUnsafePost = (request: Request): Response | undefined => {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type.trim())) {
    return errorResponse(
      createHeatError(
        DASHBOARD_ERRORS.HEAT_E_DASHBOARD_CONTENT_TYPE,
        type ? `Content-Type is ${JSON.stringify(type)}, expected "application/json"` : "Content-Type header is missing"
      ),
      415
    );
  }
  const origin = request.headers.get("origin");
  const expected = ownOrigin(request);
  if (!origin || origin.toLowerCase() !== expected) {
    return errorResponse(
      createHeatError(
        DASHBOARD_ERRORS.HEAT_E_DASHBOARD_ORIGIN,
        origin ? `Origin ${JSON.stringify(origin)} is not ${expected}` : "Origin header is missing"
      ),
      403
    );
  }
  return undefined;
};

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
