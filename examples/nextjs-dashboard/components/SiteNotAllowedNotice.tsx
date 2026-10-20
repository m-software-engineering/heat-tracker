"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_ERRORS, createHeatError } from "@m-software-engineering/heat-errors";

type Props = { siteOrigin: string };

const COPIED_MS = 2000;

/** HEAT_E_FRAME_ORIGIN_NOT_ALLOWED: the site is not on the allowlist, so its page is never loaded. */
export default function SiteNotAllowedNotice({ siteOrigin }: Props) {
  const error = createHeatError(DASHBOARD_ERRORS.HEAT_E_FRAME_ORIGIN_NOT_ALLOWED, `${siteOrigin} is not allowlisted`);
  const line = `HEAT_DASHBOARD_SITE_ORIGINS=${siteOrigin}`;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard
      .writeText(line)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <div role="status" className="ph-notice" data-code={error.code} data-testid="site-not-allowed">
      {/* Catalog messages end with a period; the title does not. */}
      <h2>{error.message.replace(/\.$/, "")}</h2>
      <p>{error.fix}</p>
      <div className="ph-copy">
        <code data-testid="allowlist-line">{line}</code>
        <button type="button" className="ph-target" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <a href={error.docs} target="_blank" rel="noreferrer">
        {error.code}
      </a>
    </div>
  );
}
