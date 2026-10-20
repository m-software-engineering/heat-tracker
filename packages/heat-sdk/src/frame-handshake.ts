/** Message type the reference dashboard listens for (examples/nextjs-dashboard/lib/frame-handshake.ts). */
export const FRAME_HELLO_TYPE = "heat-tracker:frame-hello";

/**
 * Tells a framing dashboard that the page is really showing and where it ended up (after redirects).
 * A blocked frame (X-Frame-Options, CSP) or an error page runs no SDK, so it never answers.
 * Sent before the DNT and sampling gates: it carries no tracking data and the dashboard needs it on every load.
 */
export const announceToParentFrame = (win: Window = window) => {
  try {
    if (win.parent === win) return;
    win.parent.postMessage({ type: FRAME_HELLO_TYPE, href: win.location.href }, "*");
  } catch {
    // A detached or exotic parent must never break init.
  }
};
