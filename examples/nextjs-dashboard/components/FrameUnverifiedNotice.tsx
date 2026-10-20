import { DASHBOARD_ERRORS, createHeatError } from "@m-software-engineering/heat-errors";

type Props = { reason: string };

/** HEAT_E_FRAME_CHECK_UNVERIFIED: no framing verdict, so the page is not loaded (fail closed). */
export default function FrameUnverifiedNotice({ reason }: Props) {
  const error = createHeatError(DASHBOARD_ERRORS.HEAT_E_FRAME_CHECK_UNVERIFIED, reason);
  return (
    <div role="alert" className="ph-alert" data-code={error.code} data-testid="frame-unverified">
      <strong>{error.code}</strong>
      <p>{error.message}</p>
      <p>Cause: {error.cause}.</p>
      <p>Fix: {error.fix}</p>
      <a href={error.docs} target="_blank" rel="noreferrer">
        Read the docs for {error.code}
      </a>
    </div>
  );
}
