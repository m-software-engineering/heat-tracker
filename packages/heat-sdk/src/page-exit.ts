/**
 * Page-exit hook (#28): calls `onExit` when the page is hidden (`visibilitychange` → hidden) or
 * unloaded (`pagehide`), the last moments a browser reliably lets a page start a request.
 * Returns a function that removes the listeners.
 */
export const onPageExit = (onExit: () => void, win: Window = window) => {
  const handle = (event: Event) => {
    if (event.type === "pagehide" || win.document.visibilityState === "hidden") onExit();
  };
  win.document.addEventListener("visibilitychange", handle);
  win.addEventListener("pagehide", handle);
  return () => {
    win.document.removeEventListener("visibilitychange", handle);
    win.removeEventListener("pagehide", handle);
  };
};

/** keepalive requests share a 64 KiB in-flight body limit per page; stay under it per request. */
export const KEEPALIVE_MAX_BODY_BYTES = 60_000;

const encoder = new TextEncoder();
/** UTF-8 size of `value` as a JSON body; the keepalive limit counts bytes, not UTF-16 code units. */
export const utf8Bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
