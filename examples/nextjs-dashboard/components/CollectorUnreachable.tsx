"use client";

import { useEffect, useRef } from "react";
import { fill, type Copy } from "../lib/copy";

type Props = { collectorUrl: string; copy: Copy; onRetry: () => void };

/** Sign-in when the collector can't be reached (#29): the spec line with {url}, then Retry (focused). */
export default function CollectorUnreachable({ collectorUrl, copy, onRetry }: Props) {
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => retry.current?.focus(), []);
  return (
    <div role="alert" className="onboarding-card" data-code="HEAT_E_COLLECTOR_UNREACHABLE">
      <p>{fill(copy.unreachable, { url: collectorUrl })}</p>
      <button type="button" ref={retry} onClick={onRetry}>
        {copy.retry}
      </button>
    </div>
  );
}
