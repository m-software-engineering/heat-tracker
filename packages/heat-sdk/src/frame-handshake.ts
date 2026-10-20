import { sanitizePathname } from "./privacy-rules";

/** Message type the reference dashboard listens for (examples/nextjs-dashboard/lib/frame-handshake.ts). */
export const FRAME_HELLO_TYPE = "heat-tracker:frame-hello";

/**
 * Tells a framing heat-tracker dashboard that the page is really showing and where it ended up (after redirects).
 * A blocked frame (X-Frame-Options, CSP) or an error page runs no SDK, so it never answers.
 *
 * Privacy: only `origin + pathname` is sent (no query or hash), with the pathname run through the shared privacy
 * rules (`;matrix` params dropped, email-looking segments become `[email]`, same function as the collector), and
 * only to the configured `dashboardOrigins`, each as the exact targetOrigin, so the browser drops it for any other
 * parent. Nothing is sent without the option or when Do Not Track is on. Sent before the sampling gate: it carries
 * no events and the dashboard needs it on every load.
 */
export const announceToParentFrame = (dashboardOrigins: readonly string[] | undefined, win: Window = window) => {
  if (!dashboardOrigins?.length) return;
  try {
    if (win.parent === win || win.navigator?.doNotTrack === "1") return;
    const href = `${win.location.origin}${sanitizePathname(win.location.pathname)}`;
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
