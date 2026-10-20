/**
 * Second privacy layer for stored paths (#25, quality-bar §4). The SDK already drops the query string
 * unless `privacy.keepQueryParams` allowlists a param; the collector strips these always, with no opt-in,
 * so an allowlist mistake or an older SDK cannot store them.
 */
// Rule, not list (Margot, #64): the name lowercased without `-`/`_` contains one of these
// (catches access_token, api_key, X-Amz-Signature). Rare false positives are accepted.
const SENSITIVE_PARTS = ["token", "key", "secret", "password", "passwd", "auth", "sig", "jwt", "session", "code"];
const EMAIL_VALUE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
export const MAX_TITLE_LENGTH = 200;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
};

const isSensitive = (pair: string) => {
  const eq = pair.indexOf("=");
  const name = decode(eq < 0 ? pair : pair.slice(0, eq))
    .trim()
    .toLowerCase();
  const value = eq < 0 ? "" : decode(pair.slice(eq + 1)).trim();
  const folded = name.replace(/[-_]/g, "");
  return SENSITIVE_PARTS.some((part) => folded.includes(part)) || EMAIL_VALUE.test(value);
};

/** Path segments that look like an email become `[email]`, so /users/a@b.com and /users/c@d.com group as one page. */
export const maskEmailSegments = (pathname: string) =>
  pathname
    .split("/")
    .map((segment) => (EMAIL_VALUE.test(decode(segment)) ? "[email]" : segment))
    .join("/");

const filterParams = (params: string) =>
  params
    .split("&")
    .filter((pair) => pair !== "" && !isSensitive(pair))
    .join("&");

/** Masks email segments and removes sensitive query params (also in a `#a=b` fragment); keeps everything else as sent. */
export const sanitizePath = (path: string) => {
  const hashAt = path.indexOf("#");
  const beforeHash = hashAt < 0 ? path : path.slice(0, hashAt);
  let hash = hashAt < 0 ? "" : path.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const pathname = maskEmailSegments(queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt));
  const query = queryAt < 0 ? "" : filterParams(beforeHash.slice(queryAt + 1));
  if (hash.includes("=")) hash = filterParams(hash);
  return `${pathname}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
};

/** Trimmed title, at most 200 characters; undefined when nothing is left. */
export const sanitizeTitle = (title: unknown) => {
  if (typeof title !== "string") return undefined;
  const trimmed = title.replace(/\s+/g, " ").trim();
  return trimmed ? Array.from(trimmed).slice(0, MAX_TITLE_LENGTH).join("") : undefined;
};

/** Applies `sanitizePath` to every path the ingest payload stores (event paths, pageview from/to). */
export const sanitizePayloadPaths = <T extends { events: any[] }>(payload: T): T => ({
  ...payload,
  events: payload.events.map((event) => {
    const next = { ...event, path: sanitizePath(event.path) };
    if (event.type === "pageview") {
      next.to = sanitizePath(event.to);
      if (typeof event.from === "string") next.from = sanitizePath(event.from);
      const title = sanitizeTitle(event.title);
      if (title) next.title = title;
      else delete next.title;
    }
    return next;
  })
});
