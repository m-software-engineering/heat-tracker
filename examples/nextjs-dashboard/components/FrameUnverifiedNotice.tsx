import { DASHBOARD_ERRORS } from "@m-software-engineering/heat-errors";

/**
 * HEAT_E_FRAME_CHECK_INCONCLUSIVE: the server could not check framing (timeout or unreachable site), so the page
 * is loaded anyway (fail open) and the browser decides. Shown only until the frame loads or falls back to blocked.
 */
export default function FrameUnverifiedNotice() {
  const error = DASHBOARD_ERRORS.HEAT_E_FRAME_CHECK_INCONCLUSIVE;
  return (
    <p role="status" className="ph-note" data-code={error.code} data-testid="frame-unverified">
      {error.message}
    </p>
  );
}
