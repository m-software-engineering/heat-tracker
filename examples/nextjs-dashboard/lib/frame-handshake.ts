/**
 * Handshake between the framed page and the dashboard (#59). The heat-tracker SDK posts
 * `{ type: FRAME_HELLO_TYPE, href: location.href }` to its parent on init. The iframe's `load` event cannot be
 * used instead: Chromium fires it for its own error page when framing is refused or the site is offline.
 */
export const FRAME_HELLO_TYPE = "heat-tracker:frame-hello";

/** No valid hello by then: the page blocks framing (X-Frame-Options, CSP), is offline, or does not run the SDK. */
export const HANDSHAKE_TIMEOUT_MS = 8_000;

type HelloEvent = Pick<MessageEvent, "data" | "origin" | "source">;

export type HandshakeResult =
  /** Not from the frame, or not a hello: ignore it. */
  | { kind: "ignored" }
  /** The page answered on the expected host and path. */
  | { kind: "ok"; href: string }
  /** The page answered from another host or path (it redirected): the heatmap would not line up. */
  | { kind: "redirected"; href: string };

/**
 * Accepts a hello only from the iframe's own window (`source`) and from an expected origin: the page's origin or
 * one in `allowedOrigins` (HEAT_DASHBOARD_SITE_ORIGINS). Anything else is ignored, so another frame or window
 * cannot forge a successful handshake.
 */
export const readHello = (
  event: HelloEvent,
  frameWindow: Window | null | undefined,
  pageUrl: string,
  allowedOrigins: readonly string[] = []
): HandshakeResult => {
  if (!frameWindow || event.source !== frameWindow) return { kind: "ignored" };
  const expected = new URL(pageUrl);
  if (event.origin !== expected.origin && !allowedOrigins.includes(event.origin)) return { kind: "ignored" };
  const data = event.data as { type?: unknown; href?: unknown } | null;
  if (!data || data.type !== FRAME_HELLO_TYPE || typeof data.href !== "string" || !URL.canParse(data.href)) {
    return { kind: "ignored" };
  }
  const actual = new URL(data.href);
  // The origin of the message is authoritative; the href must agree with it.
  if (actual.origin !== event.origin) return { kind: "ignored" };
  return actual.host === expected.host && actual.pathname === expected.pathname
    ? { kind: "ok", href: data.href }
    : { kind: "redirected", href: data.href };
};

/** `frame-src` for the dashboard: only allowlisted site origins may be framed ('none' when the list is empty). */
export const frameSrcPolicy = (allowedOrigins: readonly string[]) =>
  `frame-src ${allowedOrigins.length > 0 ? allowedOrigins.join(" ") : "'none'"}`;
