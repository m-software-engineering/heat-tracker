"use client";

import { useEffect, useState } from "react";
import type { Copy } from "../lib/copy";

/** After this long with nothing, the waiting line turns into the "Still nothing" hint (#29). */
export const STILL_NOTHING_MS = 120_000;

type Props = { copy: Copy; received: boolean; pagesHref?: string };

/** The snippet screen's live check: waiting → (2 min) still nothing → green "Receiving events". */
export default function LiveCheck({ copy, received, pagesHref }: Props) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (received) return;
    const timer = setTimeout(() => setStill(true), STILL_NOTHING_MS);
    return () => clearTimeout(timer);
  }, [received]);

  return (
    <p role="status" className={received ? "waiting ready" : "waiting"} data-testid="ingest-status">
      {received ? (
        <>
          {/* Not color alone: a check icon and the text carry the state too. */}
          <span className="live-icon" aria-hidden="true">
            ✓
          </span>{" "}
          {copy.snippetSuccess}{" "}
          {pagesHref ? <a href={pagesHref}>{copy.snippetSuccessLink}</a> : copy.snippetSuccessLink}
        </>
      ) : (
        <>
          <span className="data-dot" aria-hidden="true" /> {still ? copy.snippetStill : copy.snippetWaiting}
        </>
      )}
    </p>
  );
}
