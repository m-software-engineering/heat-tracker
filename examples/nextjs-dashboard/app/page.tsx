"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import CollectorUnreachable from "../components/CollectorUnreachable";
import Onboarding from "../components/Onboarding";
import PageHeatmap from "../components/PageHeatmap";
import PopularPages from "../components/PopularPages";
import ProjectList from "../components/ProjectList";
import ProjectSnippet from "../components/ProjectSnippet";
import TokenForm from "../components/TokenForm";
import { pageHref, projectHref, siteOf } from "../lib/entry-links";
import { lastProject, rememberProject } from "../lib/last-project";
import type { SessionState } from "../lib/onboarding";
import { useLocale } from "../lib/use-locale";

/** Collector calls go through the dashboard server (app/api/collector), which adds the admin token. */
const PROXY_URL = "/api/collector";

type Route = { projectId: string; path: string; site: string; isNew: boolean; ready: boolean };

/** Reads the route from the URL; a bare "/" reopens the last-opened project (#29), so step 2 is skipped. */
const readRoute = (): Route => {
  const params = new URLSearchParams(window.location.search);
  const remembered = window.location.search === "" ? lastProject() : null;
  if (remembered) window.history.replaceState(null, "", projectHref(remembered.projectId, remembered.site));
  return {
    projectId: params.get("project") ?? remembered?.projectId ?? "",
    path: params.get("path") ?? "",
    site: params.get("site") ?? remembered?.site ?? "",
    isNew: params.has("new"),
    ready: true
  };
};

export default function Page() {
  const { copy, locale } = useLocale();
  const [session, setSession] = useState<SessionState>();
  const [route, setRoute] = useState<Route>({ projectId: "", path: "", site: "", isNew: false, ready: false });
  const [siteOrigin, setSiteOrigin] = useState("");

  const loadSession = useCallback(async () => {
    setSession(undefined);
    const res = await fetch("/api/session", { cache: "no-store" });
    setSession(await res.json());
  }, []);

  useEffect(() => {
    void loadSession();
    const next = readRoute();
    setRoute(next);
    setSiteOrigin(next.site);
  }, [loadSession]);

  const { projectId, path, isNew } = route;
  const site = siteOrigin || undefined;
  useEffect(() => {
    if (projectId) rememberProject(projectId, route.site || undefined);
  }, [projectId, route.site]);

  const remembered = route.ready && !projectId ? lastProject() : null;
  const pagesHref = projectId
    ? projectHref(projectId, route.site || undefined)
    : remembered
      ? projectHref(remembered.projectId, remembered.site)
      : undefined;
  const unreachable = session?.error?.code === "HEAT_E_COLLECTOR_UNREACHABLE";
  const signedIn = Boolean(session?.signedIn) && !unreachable;

  const heading =
    !session || !route.ready
      ? "Heat Tracker"
      : !signedIn
        ? "Sign in"
        : isNew
          ? "New project"
          : !projectId
            ? "Projects"
            : !path
              ? "Pages"
              : "Heatmap";
  const current = !signedIn ? null : !projectId && !isNew ? "projects" : projectId && !path ? "pages" : null;

  return (
    <AppShell
      heading={heading}
      pagesHref={signedIn ? pagesHref : undefined}
      current={current}
      aside={
        signedIn && path ? (
          <aside className="metrics">
            <div className="metric-card">
              <h2>Keyboard</h2>
              <p>H toggles the heatmap; [ and ] change opacity.</p>
            </div>
          </aside>
        ) : null
      }
    >
      {!session || !route.ready ? <div className="skeleton-card" aria-busy="true" data-testid="shell-loading" /> : null}
      {session && unreachable ? (
        <CollectorUnreachable collectorUrl={session.collectorUrl} copy={copy} onRetry={loadSession} />
      ) : null}
      {session && !unreachable && !session.signedIn ? <TokenForm onSignedIn={loadSession} copy={copy} /> : null}
      {signedIn && isNew ? <Onboarding publicCollectorUrl={session!.publicCollectorUrl} copy={copy} /> : null}
      {signedIn && route.ready && !isNew && !projectId ? (
        <ProjectList
          collectorUrl={PROXY_URL}
          hrefFor={(p) => projectHref(p.id, siteOf(p.name))}
          copy={copy}
          locale={locale}
          createHref="?new"
        />
      ) : null}
      {signedIn && !isNew && projectId && !path ? (
        <PopularPages
          collectorUrl={PROXY_URL}
          projectId={projectId}
          hrefFor={(p) => pageHref(projectId, p.path, site)}
          copy={copy}
          locale={locale}
          snippet={
            <ProjectSnippet
              publicCollectorUrl={session!.publicCollectorUrl}
              projectId={projectId}
              collectorUrl={PROXY_URL}
              copiedLabel={copy.copied}
            />
          }
        />
      ) : null}
      {signedIn && !isNew && projectId && path ? (
        <>
          <div className="controls">
            <label className="control">
              Site URL
              <input
                value={siteOrigin}
                onChange={(e) => setSiteOrigin(e.target.value)}
                placeholder="https://your-site.example"
              />
            </label>
          </div>
          <PageHeatmap
            collectorUrl={PROXY_URL}
            projectId={projectId}
            siteOrigin={siteOrigin}
            path={path}
            copy={copy}
            locale={locale}
          />
        </>
      ) : null}
    </AppShell>
  );
}
