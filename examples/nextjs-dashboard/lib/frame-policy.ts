/**
 * Decides whether a site lets the dashboard frame it, from the site's response headers.
 * Browsers hide a blocked cross-origin frame from the parent (it looks like any other cross-origin
 * frame), so the dashboard asks its own server route to fetch the page and read these headers.
 */
export type FrameVerdict = { blocked: boolean; reason: string };

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

/** Origins the server may fetch, from `HEAT_DASHBOARD_SITE_ORIGINS` (comma-separated). */
export const allowedSiteOrigins = (value = process.env.HEAT_DASHBOARD_SITE_ORIGINS ?? "") =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);

/**
 * Fetches `siteUrl` (2.5 s budget) and returns the framing verdict. Only URLs on an allowlisted origin
 * are fetched, so the route cannot be used to make the dashboard server request arbitrary hosts.
 */
export const checkFrame = async (
  siteUrl: string,
  dashboardOrigin: string,
  allowedOrigins: string[],
  timeoutMs = 2500
): Promise<FrameVerdict> => {
  const origin = allowedOrigins.find((allowed) => allowed === new URL(siteUrl).origin);
  if (!origin) {
    // Not checkable: show the frame and let the browser decide.
    return { blocked: false, reason: "site origin is not in HEAT_DASHBOARD_SITE_ORIGINS, so framing was not checked" };
  }
  // Host comes only from the allowlist; path and query are copied onto it so "//other-host" cannot redirect the fetch.
  const requested = new URL(siteUrl);
  const url = new URL(origin);
  url.pathname = requested.pathname;
  url.search = requested.search;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return frameVerdict(res.headers, dashboardOrigin, res.url || siteUrl);
  } catch {
    // Unreachable from the dashboard server is not proof of blocking; let the browser try.
    return { blocked: false, reason: "site not reachable from the dashboard server" };
  }
};
