"use client";

import { useEffect, useState } from "react";
import { fetchProjects } from "../lib/api";
import { trackingSnippet } from "../lib/onboarding";
import CopyButton from "./CopyButton";

type Props = {
  publicCollectorUrl: string;
  projectId: string;
  collectorUrl: string;
  copiedLabel?: string;
  copyLabel?: string;
};

/**
 * #24's install snippet for a project that has no pages yet. The key comes from `GET /api/projects`
 * (admin-only, Margot #64), so the snippet shows in any signed-in browser.
 */
export default function ProjectSnippet({
  publicCollectorUrl,
  projectId,
  collectorUrl,
  copiedLabel = "Copied",
  copyLabel = "Copy"
}: Props) {
  const [projectKey, setProjectKey] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const find = async (cursor?: string | null): Promise<string | undefined> => {
      const page = await fetchProjects(collectorUrl, cursor);
      const found = page.projects.find((p) => p.id === projectId);
      if (found || !page.meta.nextCursor) return found?.projectKey;
      return find(page.meta.nextCursor);
    };
    find()
      .then((key) => !cancelled && setProjectKey(key))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [collectorUrl, projectId]);

  if (!projectKey) return null;
  const snippet = trackingSnippet(publicCollectorUrl, projectKey, window.location.origin);
  return (
    <div className="onboarding-card">
      <p>
        Paste this before <code>&lt;/body&gt;</code> on every page you want to track.
      </p>
      <pre data-testid="snippet" tabIndex={0}>{snippet}</pre>
      <CopyButton text={() => snippet} label={copyLabel} done={copiedLabel} />
    </div>
  );
}
