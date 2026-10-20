/** Message type the reference dashboard listens for (examples/nextjs-dashboard/lib/frame-handshake.ts). */
export const FRAME_HELLO_TYPE = "heat-tracker:frame-hello";

/**
 * Tells a framing heat-tracker dashboard that the page is really showing and where it ended up (after redirects).
 * A blocked frame (X-Frame-Options, CSP) or an error page runs no SDK, so it never answers.
 *
 * Privacy: only `origin + pathname` is sent (no query or hash), and only to the configured `dashboardOrigins`, each
 * as the exact targetOrigin, so the browser drops it for any other parent. Without the option nothing is sent.
 * Sent before the DNT and sampling gates: it carries no tracking data and the dashboard needs it on every load.
 */
export const announceToParentFrame = (dashboardOrigins: readonly string[] | undefined, win: Window = window) => {
  if (!dashboardOrigins?.length) return;
  try {
    if (win.parent === win) return;
    const href = `${win.location.origin}${win.location.pathname}`;
    for (const entry of dashboardOrigins) {
      if (typeof entry !== "string" || !URL.canParse(entry)) continue;
      const target = new URL(entry).origin;
      if (target === "null") continue;
      win.parent.postMessage({ type: FRAME_HELLO_TYPE, href }, target);
    }
  } catch {
    // A detached or exotic parent must never break init.
  }
};
