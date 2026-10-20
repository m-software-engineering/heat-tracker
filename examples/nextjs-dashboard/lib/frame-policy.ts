import { DASHBOARD_ERRORS, createHeatError, formatHeatError } from "@m-software-engineering/heat-errors";

/**
 * Decides whether a site lets the dashboard frame it, from the site's response headers.
 * Browsers hide a blocked cross-origin frame from the parent (it looks like any other cross-origin
 * frame), so the dashboard asks its own server route to fetch the page and read these headers.
 *
 * Discriminated on `verified`: only an unverified result carries a `reason`.
 */
export type FrameVerdict = VerifiedFrame | InconclusiveFrame | RefusedFrame;

/** The site's headers were read: `blocked` is the verdict. */
export type VerifiedFrame = { verified: true; blocked: boolean; detail: string; reason?: never };

/**
 * No verdict because the site did not answer in time or could not be reached from the dashboard server.
 * The browser enforces framing anyway, so the dashboard fails open: it loads the page with
 * HEAT_E_FRAME_CHECK_INCONCLUSIVE and falls back to the blocked state if the frame does not load.
 */
export type InconclusiveFrame = {
  verified: false;
  blocked: false;
  reason: "timeout" | "unreachable";
  detail: string;
};

/**
 * The dashboard refuses to load the page (fail closed): `not-allowed` when the origin (or a redirect hop) is not in
 * HEAT_DASHBOARD_SITE_ORIGINS, `redirect` for a bad or too long redirect chain, `check-failed` when the
 * dashboard's own frame-check route gave no answer.
 */
export type RefusedFrame = {
  verified: false;
  blocked: false;
  reason: "not-allowed" | "redirect" | "check-failed";
  /** false only for `not-allowed`. */
  allowed?: false;
  detail: string;
};

/** True when the check was inconclusive and the dashboard should load the page anyway (fail open). */
export const isInconclusive = (verdict: FrameVerdict): verdict is InconclusiveFrame =>
  !verdict.verified && (verdict.reason === "timeout" || verdict.reason === "unreachable");

type HeaderSource = { get(name: string): string | null };

const originParts = (origin: string) => {
  const url = new URL(origin);
  const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return { scheme: url.protocol.replace(/:$/, ""), host: url.hostname.toLowerCase(), port };
};

// CSP source expression match for frame-ancestors (CSP3 §6.7.2, simplified: no path matching).
const sourceAllows = (source: string, ancestor: string, site: string) => {
  const s = source.toLowerCase();
  if (s === "*") return true;
  if (s === "'self'") return new URL(ancestor).origin === new URL(site).origin;
  const a = originParts(ancestor);
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === `${a.scheme}:`;
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+|\*)(?::(\d+|\*))?/.exec(s);
  if (!m) return false;
  const [, scheme, wildcard, host, port] = m;
  if (scheme && scheme !== a.scheme) return false;
  if (
    !scheme &&
    a.scheme !== originParts(site).scheme &&
    !(a.scheme === "https" && originParts(site).scheme === "http")
  ) {
    return false;
  }
  if (host !== "*") {
    if (wildcard ? !a.host.endsWith(`.${host}`) : a.host !== host) return false;
  }
  const defaultPort = a.scheme === "https" ? "443" : "80";
  return port === "*" || (port ?? defaultPort) === a.port;
};

const frameAncestorsLists = (csp: string) =>
  csp
    .split(",")
    .map((policy) =>
      policy
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .find(([name]) => name?.toLowerCase() === "frame-ancestors")
    )
    .filter((d): d is string[] => Boolean(d))
    .map(([, ...sources]) => sources);

const verified = (blocked: boolean, detail: string): VerifiedFrame => ({ verified: true, blocked, detail });

/** Applies `Content-Security-Policy: frame-ancestors` first and `X-Frame-Options` only without it, like browsers. */
export const frameVerdict = (headers: HeaderSource, dashboardOrigin: string, siteUrl: string): VerifiedFrame => {
  const lists = frameAncestorsLists(headers.get("content-security-policy") ?? "");
  if (lists.length > 0) {
    const denied = lists.find((sources) => !sources.some((source) => sourceAllows(source, dashboardOrigin, siteUrl)));
    return denied
      ? verified(true, `Content-Security-Policy frame-ancestors ${denied.join(" ") || "(empty)"}`)
      : verified(false, "frame-ancestors allows the dashboard origin");
  }
  const xfo = (headers.get("x-frame-options") ?? "").trim().toUpperCase();
  if (xfo === "DENY") return verified(true, "X-Frame-Options DENY");
  if (xfo === "SAMEORIGIN" && new URL(dashboardOrigin).origin !== new URL(siteUrl).origin) {
    return verified(true, "X-Frame-Options SAMEORIGIN");
  }
  return verified(false, "no framing restriction");
};

/** Parses one allowlist entry to its origin, or returns null when it is not a plain http(s) origin. */
export const parseSiteOrigin = (entry: string): string | null => {
  if (entry.includes("*") || !URL.canParse(entry)) return null;
  const url = new URL(entry);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return url.origin;
};

/**
 * Origins the server may fetch, from `HEAT_DASHBOARD_SITE_ORIGINS` (comma-separated). Entries that are not
 * origins (`example.com`, `*`, `*.example.com`, URLs with a path) are skipped with a HEAT_E_FRAME_ORIGIN_INVALID
 * warning; this never throws.
 */
export const allowedSiteOrigins = (
  value = process.env.HEAT_DASHBOARD_SITE_ORIGINS ?? "",
  // Server-side config warning; the dashboard has no logger.
  // eslint-disable-next-line no-console
  warn: (message: string) => void = console.warn
): string[] => {
  const origins: string[] = [];
  for (const entry of value
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const origin = parseSiteOrigin(entry);
    if (!origin) {
      const cause = entry.includes("*")
        ? `"${entry}" is a wildcard, which is not supported`
        : `"${entry}" is not an origin`;
      warn(formatHeatError(createHeatError(DASHBOARD_ERRORS.HEAT_E_FRAME_ORIGIN_INVALID, cause)));
    } else if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
};

/** Redirects followed before giving up (each hop is checked against the allowlist). */
export const MAX_REDIRECTS = 5;

const notAllowed = (detail: string): RefusedFrame => ({
  verified: false,
  blocked: false,
  reason: "not-allowed",
  allowed: false,
  detail
});

const badRedirect = (detail: string): RefusedFrame => ({ verified: false, blocked: false, reason: "redirect", detail });

/**
 * Fetches `siteUrl` (2.5 s budget for all hops) and returns the framing verdict. Only allowlisted origins are
 * fetched: redirects are followed by hand (at most MAX_REDIRECTS), and a hop to any other origin stops with
 * `reason: "not-allowed"` without requesting it, so the route cannot make the dashboard server reach arbitrary hosts.
 * A timeout or a network error gives `{ verified: false, reason: "timeout" | "unreachable" }` (fail open).
 */
export const checkFrame = async (
  siteUrl: string,
  dashboardOrigin: string,
  allowedOrigins: string[],
  timeoutMs = 2500
): Promise<FrameVerdict> => {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = siteUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const requested = new URL(current);
    const origin = allowedOrigins.find((allowed) => allowed === requested.origin);
    if (!origin)
      return notAllowed(
        hop === 0
          ? `${requested.origin} is not in HEAT_DASHBOARD_SITE_ORIGINS`
          : `redirects to ${requested.origin}, which is not in HEAT_DASHBOARD_SITE_ORIGINS`
      );
    // Host comes only from the allowlist; path and query are copied onto it so "//other-host" cannot redirect the fetch.
    const url = new URL(origin);
    url.pathname = requested.pathname;
    url.search = requested.search;
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", redirect: "manual", signal });
      await res.body?.cancel();
    } catch {
      // Inconclusive, not proof of blocking: the browser enforces framing anyway, so the dashboard fails open.
      return signal.aborted
        ? {
            verified: false,
            blocked: false,
            reason: "timeout",
            detail: `${url.origin} did not answer within ${timeoutMs} ms`
          }
        : {
            verified: false,
            blocked: false,
            reason: "unreachable",
            detail: `${url.origin} is not reachable from the dashboard server`
          };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || !location)
      return frameVerdict(res.headers, dashboardOrigin, url.toString());
    if (!URL.canParse(location, url)) return badRedirect("redirect location is not a URL");
    current = new URL(location, url).toString();
  }
  return badRedirect(`more than ${MAX_REDIRECTS} redirects`);
};
