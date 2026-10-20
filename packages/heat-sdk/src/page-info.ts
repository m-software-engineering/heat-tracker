/**
 * Page identity sent with every event (#25): the path without its query string or hash, except params
 * the site allowlists in `privacy.keepQueryParams`, and the masked document title on pageviews.
 * Sensitive params are never kept, even when allowlisted (the collector strips them again).
 */
// Same rule as the collector: the name lowercased without `-`/`_` contains one of these.
const SENSITIVE_PARTS = ["token", "key", "secret", "password", "passwd", "auth", "sig", "jwt", "session", "code"];
const EMAIL_VALUE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const MAX_TITLE_LENGTH = 200;
const MASK = "•••";

const isSensitive = (name: string, value: string) => {
  const folded = name.toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_PARTS.some((part) => folded.includes(part)) || EMAIL_VALUE.test(value.trim());
};

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Email-looking path segments become `[email]` (one page for /users/<any email>). */
const maskEmails = (pathname: string) =>
  pathname
    .split("/")
    .map((segment) => (EMAIL_VALUE.test(decode(segment)) ? "[email]" : segment))
    .join("/");

export const pagePath = (keepQueryParams: string[]) => {
  const { search } = location;
  const pathname = maskEmails(location.pathname);
  if (keepQueryParams.length === 0 || !search) return pathname;
  const allowed = new Set(keepQueryParams.map((name) => name.toLowerCase()));
  const kept = new URLSearchParams();
  new URLSearchParams(search).forEach((value, name) => {
    if (allowed.has(name.toLowerCase()) && !isSensitive(name, value)) kept.append(name, value);
  });
  const query = kept.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/**
 * `document.title` with the text of `maskTextSelectors` elements replaced by •••, whitespace collapsed,
 * at most 200 characters. Undefined when nothing is left, so the dashboard falls back to the path.
 */
export const pageTitle = (maskTextSelectors: string[]) => {
  let title = document.title || "";
  for (const selector of maskTextSelectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    nodes.forEach((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (text) title = title.split(text).join(MASK);
    });
  }
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.split(MASK).join("").trim() === "") return undefined;
  return Array.from(trimmed).slice(0, MAX_TITLE_LENGTH).join("");
};
