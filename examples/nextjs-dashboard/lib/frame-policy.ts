import { DASHBOARD_ERRORS, createHeatError, formatHeatError } from "@m-software-engineering/heat-errors";

/**
 * Decides whether a site lets the dashboard frame it, from the site's response headers.
 * Browsers hide a blocked cross-origin frame from the parent (it looks like any other cross-origin
 * frame), so the dashboard asks its own server route to fetch the page and read these headers.
 */
export type FrameVerdict = {
  blocked: boolean;
  reason: string;
  /** false when the site origin is not in HEAT_DASHBOARD_SITE_ORIGINS: the dashboard does not load it. */
  allowed?: boolean;
  /** false when no verdict could be reached (timeout, too many redirects): the dashboard does not load the page. */
  verified?: boolean;
};

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

/** Applies `Content-Security-Policy: frame-ancestors` first and `X-Frame-Options` only without it, like browsers. */
export const frameVerdict = (headers: HeaderSource, dashboardOrigin: string, siteUrl: string): FrameVerdict => {
  const lists = frameAncestorsLists(headers.get("content-security-policy") ?? "");
  if (lists.length > 0) {
    const denied = lists.find((sources) => !sources.some((source) => sourceAllows(source, dashboardOrigin, siteUrl)));
    return denied
      ? { blocked: true, reason: `Content-Security-Policy frame-ancestors ${denied.join(" ") || "(empty)"}` }
      : { blocked: false, reason: "frame-ancestors allows the dashboard origin" };
  }
  const xfo = (headers.get("x-frame-options") ?? "").trim().toUpperCase();
  if (xfo === "DENY") return { blocked: true, reason: "X-Frame-Options DENY" };
  if (xfo === "SAMEORIGIN" && new URL(dashboardOrigin).origin !== new URL(siteUrl).origin) {
    return { blocked: true, reason: "X-Frame-Options SAMEORIGIN" };
  }
  return { blocked: false, reason: "no framing restriction" };
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

const notAllowed = (origin: string): FrameVerdict => ({
  blocked: false,
  allowed: false,
  reason: `${origin} is not in HEAT_DASHBOARD_SITE_ORIGINS`
});

/**
 * Fetches `siteUrl` (2.5 s budget for all hops) and returns the framing verdict. Only allowlisted origins are
 * fetched: redirects are followed by hand (at most MAX_REDIRECTS), and a hop to any other origin stops with
 * `allowed: false` without requesting it, so the route cannot make the dashboard server reach arbitrary hosts.
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
      return hop === 0
        ? notAllowed(requested.origin)
        : {
            ...notAllowed(requested.origin),
            reason: `redirects to ${requested.origin}, which is not in HEAT_DASHBOARD_SITE_ORIGINS`
          };
    // Host comes only from the allowlist; path and query are copied onto it so "//other-host" cannot redirect the fetch.
    const url = new URL(origin);
    url.pathname = requested.pathname;
    url.search = requested.search;
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", redirect: "manual", signal });
      await res.body?.cancel();
    } catch {
      // Unreachable from the dashboard server is not proof of blocking; let the browser try.
      return { blocked: false, reason: "site not reachable from the dashboard server" };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || !location)
      return frameVerdict(res.headers, dashboardOrigin, url.toString());
    if (!URL.canParse(location, url))
      return { blocked: false, verified: false, reason: "redirect location is not a URL" };
    current = new URL(location, url).toString();
  }
  return { blocked: false, verified: false, reason: `more than ${MAX_REDIRECTS} redirects` };
};
