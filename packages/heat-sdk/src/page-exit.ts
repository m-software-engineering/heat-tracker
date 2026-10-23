/**
 * Page-exit hook (#28): calls `onExit` when the page is hidden (`visibilitychange` → hidden) or
 * unloaded (`pagehide`), the last moments a browser reliably lets a page start a request.
 * Returns a function that removes the listeners.
 */
export const onPageExit = (onExit: (reason: "hidden" | "pagehide") => void, win: Window = window) => {
  const handleVisibility = () => {
    if (win.document.visibilityState === "hidden") onExit("hidden");
  };
  const handlePageHide = () => onExit("pagehide");
  win.document.addEventListener("visibilitychange", handleVisibility);
  win.addEventListener("pagehide", handlePageHide);
  return () => {
    win.document.removeEventListener("visibilitychange", handleVisibility);
    win.removeEventListener("pagehide", handlePageHide);
  };
};

/** One conservative keepalive budget for the entire page lifetime, shared by all trackers and exits. */
export const KEEPALIVE_MAX_BODY_BYTES = 60_000;
export const exitBudget = { remaining: KEEPALIVE_MAX_BODY_BYTES };

const encoder = new TextEncoder();
/** UTF-8 size of `value` as a JSON body; the keepalive limit counts bytes, not UTF-16 code units. */
export const utf8Bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
