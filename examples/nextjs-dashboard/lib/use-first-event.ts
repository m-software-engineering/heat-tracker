import { useEffect, useState } from "react";
import type { ProjectSummary } from "./onboarding";

/** Live check interval (#29): every 3 s while the tab is visible, paused while it is hidden. */
export const POLL_MS = 3_000;

/**
 * Calls `poll` every POLL_MS while the tab is visible until it returns true. Shared by the new-project
 * snippet (by-key lookup) and the waiting pages list.
 */
export const useVisiblePoll = (poll: (() => Promise<boolean>) | null) => {
  useEffect(() => {
    if (!poll) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(run, ms);
    };
    const run = async () => {
      const done = await poll().catch(() => false);
      if (done) stopped = true;
      else schedule(POLL_MS);
    };
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : schedule(0));
    document.addEventListener("visibilitychange", onVisibility);
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);
};

/** Resolves the project once the collector has seen the first event for `projectKey`. */
export const useFirstEvent = (projectKey: string | undefined) => {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [poll, setPoll] = useState<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    if (!projectKey) return setPoll(null);
    setPoll(() => async () => {
      const res = await fetch(`/api/collector/api/projects/by-key/${encodeURIComponent(projectKey)}`);
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (!body?.project) return false;
      setProject(body.project as ProjectSummary);
      return true;
    });
  }, [projectKey]);
  useVisiblePoll(poll);
  return project;
};
