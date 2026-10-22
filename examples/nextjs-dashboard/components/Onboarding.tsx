"use client";

import { useEffect, useState } from "react";
import type { Copy } from "../lib/copy";
import { projectHref, siteOf } from "../lib/entry-links";
import { generateProjectKey, PROJECT_KEY_STORAGE, trackingSnippet, type ProjectSummary } from "../lib/onboarding";
import { useFirstEvent } from "../lib/use-first-event";
import CopyButton from "./CopyButton";
import LiveCheck from "./LiveCheck";

type Props = { publicCollectorUrl: string; copy: Copy; onProject?: (project: ProjectSummary) => void };

const storedKey = () => {
  const existing = window.localStorage.getItem(PROJECT_KEY_STORAGE);
  if (existing) return existing;
  const key = generateProjectKey();
  window.localStorage.setItem(PROJECT_KEY_STORAGE, key);
  return key;
};

/**
 * New project (#29 step 3): no name field; the collector names the project after the site's origin
 * on its first event. Shows the snippet, Copy (2 s "Copied") and the live check.
 */
export default function Onboarding({ publicCollectorUrl, copy, onProject }: Props) {
  const [projectKey, setProjectKey] = useState<string>();
  useEffect(() => setProjectKey(storedKey()), []);
  const project = useFirstEvent(projectKey);
  useEffect(() => {
    if (project) onProject?.(project);
  }, [project, onProject]);

  if (!projectKey) return null;
  const snippet = trackingSnippet(publicCollectorUrl, projectKey, window.location.origin);
  return (
    <div className="onboarding-card" data-testid="snippet-screen">
      <p>
        Paste this before <code>&lt;/body&gt;</code> on every page you want to track.
      </p>
      <pre data-testid="snippet" tabIndex={0}>
        {snippet}
      </pre>
      <CopyButton text={() => snippet} label={copy.copy} done={copy.copied} />
      <LiveCheck
        copy={copy}
        received={Boolean(project)}
        pagesHref={project ? projectHref(project.id, siteOf(project.name)) : undefined}
      />
    </div>
  );
}
