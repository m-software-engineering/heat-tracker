"use client";

import { useEffect, useState } from "react";
import {
  generateProjectKey,
  PROJECT_KEY_STORAGE,
  receivingLabel,
  trackingSnippet,
  type ProjectSummary
} from "../lib/onboarding";

type Props = { publicCollectorUrl: string; onProject: (project: ProjectSummary) => void };

const POLL_MS = 2_000;

const storedKey = () => {
  const existing = window.localStorage.getItem(PROJECT_KEY_STORAGE);
  if (existing) return existing;
  const key = generateProjectKey();
  window.localStorage.setItem(PROJECT_KEY_STORAGE, key);
  return key;
};

/** Snippet + copy button + live "Waiting…" / "Receiving events from <origin>" state. */
export default function Onboarding({ publicCollectorUrl, onProject }: Props) {
  const [projectKey, setProjectKey] = useState<string>();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setProjectKey(storedKey()), []);

  useEffect(() => {
    if (!projectKey) return;
    let stopped = false;
    const poll = async () => {
      const res = await fetch(`/api/collector/api/projects/by-key/${encodeURIComponent(projectKey)}`).catch(() => null);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      if (stopped) return;
      if (body?.project) {
        setProject(body.project);
        onProject(body.project);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectKey, onProject]);

  if (!projectKey) return null;
  const snippet = trackingSnippet(publicCollectorUrl, projectKey);

  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  };

  return (
    <div className="onboarding-card">
      <h2>Add Heat Tracker to your site</h2>
      <p>
        Paste this before <code>&lt;/body&gt;</code> on every page you want to track.
      </p>
      <pre data-testid="snippet">{snippet}</pre>
      <button type="button" onClick={copy}>
        {copied ? "Copied" : "Copy snippet"}
      </button>
      <p role="status" aria-live="polite" data-testid="ingest-status">
        {receivingLabel(project)}
      </p>
    </div>
  );
}
