import { DASHBOARD_ERRORS } from "@m-software-engineering/heat-errors";

/** HEAT_E_FRAME_NO_RESPONSE: no valid handshake within 8 s (blocked by X-Frame-Options or CSP, offline, or no SDK). */
export function FrameNoResponseNotice({ pageUrl }: { pageUrl: string }) {
  const error = DASHBOARD_ERRORS.HEAT_E_FRAME_NO_RESPONSE;
  return (
    <div role="alert" className="ph-alert" data-code={error.code} data-testid="frame-no-response">
      <p>{error.message}</p>
      <a href={pageUrl} target="_blank" rel="noopener noreferrer">
        Open page in new tab
      </a>
    </div>
  );
}

/** HEAT_E_FRAME_REDIRECTED: the page answered from another host or path, so the heatmap is hidden. */
export function FrameRedirectedNotice({ href }: { href: string }) {
  const error = DASHBOARD_ERRORS.HEAT_E_FRAME_REDIRECTED;
  const [before, after] = error.message.split("<url>");
  return (
    <div role="alert" className="ph-alert" data-code={error.code} data-testid="frame-redirected">
      {/* The URL comes from the framed page: rendered as a text node, never as HTML. */}
      <p>
        {before}
        {href}
        {after}
      </p>
    </div>
  );
}
