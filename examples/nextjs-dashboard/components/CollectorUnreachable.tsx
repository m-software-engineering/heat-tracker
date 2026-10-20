"use client";

import type { SessionState } from "../lib/onboarding";

type Props = { error: NonNullable<SessionState["error"]>; onRetry: () => void };

/** "Can't reach the collector at {url}. Check that the collector container is running: `docker compose ps`." */
export default function CollectorUnreachable({ error, onRetry }: Props) {
  return (
    <div role="alert" className="onboarding-card">
      <p>
        {error.message} {error.fix}
      </p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
