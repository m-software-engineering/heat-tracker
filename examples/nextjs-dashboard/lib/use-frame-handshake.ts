import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { DASHBOARD_ERRORS, createHeatError, formatHeatError } from "@m-software-engineering/heat-errors";
import { readHello } from "./frame-handshake";

// Layout effect: the listener is on before the browser can start loading the iframe, so a fast page's hello is
// never missed. Plain effect on the server, where neither runs.
const useListenerEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type HandshakeState =
  | { status: "waiting" }
  | { status: "ok" }
  | { status: "no-response" }
  | { status: "redirected"; href: string };

/**
 * Waits for the framed page's hello (see lib/frame-handshake.ts). After `timeoutMs` without a valid one the state is
 * `no-response`; the listener stays on, so a page that answers late still recovers. Details (`detail`, the URLs)
 * go to the console only, never into the visible notice.
 */
export const useFrameHandshake = (
  frameRef: RefObject<HTMLIFrameElement | null>,
  pageUrl: string,
  active: boolean,
  allowedOrigins: readonly string[],
  timeoutMs: number,
  detail: string
): HandshakeState => {
  const [state, setState] = useState<HandshakeState>({ status: "waiting" });
  const allowKey = allowedOrigins.join(",");

  useListenerEffect(() => {
    setState({ status: "waiting" });
    if (!active || !pageUrl) return;
    const origins = allowKey ? allowKey.split(",") : [];
    const onMessage = (event: MessageEvent) => {
      const result = readHello(event, frameRef.current?.contentWindow, pageUrl, origins);
      if (result.kind === "ok") setState({ status: "ok" });
      if (result.kind === "redirected") {
        // eslint-disable-next-line no-console -- devtools-only diagnostics
        console.warn(
          formatHeatError(
            createHeatError(DASHBOARD_ERRORS.HEAT_E_FRAME_REDIRECTED, `expected ${pageUrl}, got ${result.href}`)
          )
        );
        setState({ status: "redirected", href: result.href });
      }
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        // eslint-disable-next-line no-console -- devtools-only diagnostics
        console.warn(
          formatHeatError(
            createHeatError(
              DASHBOARD_ERRORS.HEAT_E_FRAME_NO_RESPONSE,
              `no handshake from ${pageUrl} within ${timeoutMs / 1000} s; frame check: ${detail}`
            )
          )
        );
        return { status: "no-response" };
      });
    }, timeoutMs);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [frameRef, pageUrl, active, allowKey, timeoutMs, detail]);

  return state;
};
