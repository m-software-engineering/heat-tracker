import { DASHBOARD_ERRORS, createHeatError } from "@m-software-engineering/heat-errors";

type Props = { reason: string; dashboardOrigin: string };

/** HEAT_E_FRAME_BLOCKED, with the catalog fix filled in for this dashboard's origin. */
export default function FrameBlockedNotice({ reason, dashboardOrigin }: Props) {
  const error = createHeatError(DASHBOARD_ERRORS.HEAT_E_FRAME_BLOCKED, reason);
  const fix = error.fix.replace("<dashboard origin>", dashboardOrigin);
  return (
    <div role="alert" className="ph-alert" data-code={error.code}>
      <strong>{error.code}</strong>
      <p>{error.message}</p>
      <p>Cause: {error.cause}.</p>
      <p>Fix: {fix}</p>
      <a href={error.docs} target="_blank" rel="noreferrer">
        Read the docs for {error.code}
      </a>
    </div>
  );
}
