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

/** keepalive requests share a 64 KiB in-flight body limit per page; stay under it per request. */
export const KEEPALIVE_MAX_BODY_BYTES = 60_000;
