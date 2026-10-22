"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Copy } from "../lib/copy";
import { projectHref, siteOf } from "../lib/entry-links";
import { generateProjectKey, PROJECT_KEY_STORAGE, PROJECT_NAME_STORAGE, trackingSnippet } from "../lib/onboarding";
import { useFirstEvent } from "../lib/use-first-event";
import CopyButton from "./CopyButton";
import LiveCheck from "./LiveCheck";

type Props = { publicCollectorUrl: string; copy: Copy };

/** Spec default for the project name field (#29). */
export const DEFAULT_PROJECT_NAME = "My site";

const storedKey = () => {
  const existing = window.localStorage.getItem(PROJECT_KEY_STORAGE);
  if (existing) return existing;
  const key = generateProjectKey();
  window.localStorage.setItem(PROJECT_KEY_STORAGE, key);
  return key;
};

/** New project (#29 step 3): a name field prefilled "My site"; "Create" opens the snippet screen. */
export default function Onboarding({ publicCollectorUrl, copy }: Props) {
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const [projectKey, setProjectKey] = useState<string>();

  // A key already issued in this browser goes straight to its snippet (reloading keeps the screen).
  useEffect(() => {
    if (window.localStorage.getItem(PROJECT_KEY_STORAGE)) setProjectKey(storedKey());
  }, []);

  const create = (event: FormEvent) => {
    event.preventDefault();
    window.localStorage.setItem(PROJECT_NAME_STORAGE, name.trim() || DEFAULT_PROJECT_NAME);
    setProjectKey(storedKey());
  };

  if (!projectKey) {
    return (
      <form className="onboarding-card" onSubmit={create} data-testid="new-project">
        <label className="control">
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit">Create</button>
      </form>
    );
  }
  return <SnippetScreen publicCollectorUrl={publicCollectorUrl} projectKey={projectKey} copy={copy} />;
}

function SnippetScreen({ publicCollectorUrl, projectKey, copy }: Props & { projectKey: string }) {
  const project = useFirstEvent(projectKey);
  const snippet = trackingSnippet(publicCollectorUrl, projectKey, window.location.origin);
  return (
    <div className="onboarding-card" data-testid="snippet-screen">
      <p>
        Paste this before <code>&lt;/body&gt;</code> on every page you want to track.
      </p>
      <pre data-testid="snippet">{snippet}</pre>
      <CopyButton text={() => snippet} label="Copy" done={copy.copied} />
      <LiveCheck
        copy={copy}
        received={Boolean(project)}
        pagesHref={project ? projectHref(project.id, siteOf(project.name)) : undefined}
      />
    </div>
  );
}
