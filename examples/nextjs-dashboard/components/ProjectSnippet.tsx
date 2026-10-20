"use client";

import { useEffect, useState } from "react";
import { PROJECT_KEY_STORAGE, trackingSnippet } from "../lib/onboarding";

type Props = { publicCollectorUrl: string; projectId: string; collectorUrl: string };

/**
 * #24's install snippet for a project that has no pages yet. The projectKey is only known to the browser
 * that generated it, so the snippet shows when the stored key belongs to this project.
 */
export default function ProjectSnippet({ publicCollectorUrl, projectId, collectorUrl }: Props) {
  const [projectKey, setProjectKey] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const key = window.localStorage.getItem(PROJECT_KEY_STORAGE);
    if (!key) return;
    let cancelled = false;
    fetch(`${collectorUrl}/api/projects/by-key/${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => !cancelled && body?.project?.id === projectId && setProjectKey(key))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [collectorUrl, projectId]);

  if (!projectKey) return null;
  const snippet = trackingSnippet(publicCollectorUrl, projectKey);
  return (
    <div className="onboarding-card">
      <p>
        Paste this before <code>&lt;/body&gt;</code> on every page you want to track.
      </p>
      <pre data-testid="snippet">{snippet}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(snippet);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy snippet"}
      </button>
    </div>
  );
}
