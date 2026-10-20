/**
 * Page identity sent with every event (#25): the path without its query string or hash, except params
 * the site allowlists in `privacy.keepQueryParams`, and the masked document title on pageviews.
 * Sensitive params are never kept, even when allowlisted (the collector strips them again).
 */
import { isSensitivePair, normalizeParamName, sanitizePathname } from "./privacy-rules";

const MAX_TITLE_LENGTH = 200;
const MASK = "•••";

/** Allowlisted, non-sensitive pairs are kept as sent (raw, so decoding matches the collector's). */
export const pagePath = (keepQueryParams: string[]) => {
  const pathname = sanitizePathname(location.pathname);
  const search = location.search.slice(1);
  if (keepQueryParams.length === 0 || !search) return pathname;
  const allowed = new Set(keepQueryParams.map(normalizeParamName));
  const query = search
    .split("&")
    .filter((pair) => pair !== "" && !isSensitivePair(pair) && allowed.has(normalizeParamName(pair.split("=")[0])))
    .join("&");
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
