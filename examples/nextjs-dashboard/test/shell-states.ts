// #29 shell states for the e2e harness: each one mounted inside AppShell, in EN or PT-BR (?lang=pt).
import { createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import AppShell from "../components/AppShell";
import CollectorUnreachable from "../components/CollectorUnreachable";
import ErrorPanel from "../components/ErrorPanel";
import LiveCheck from "../components/LiveCheck";
import Onboarding from "../components/Onboarding";
import { ProjectsEmpty } from "../components/ProjectList";
import TokenForm from "../components/TokenForm";
import { COPY, pickLocale } from "../lib/copy";

const SAMPLE_ERROR = {
  code: "HEAT_E_DASHBOARD_FETCH" as const,
  message: "The dashboard couldn't load data from the collector.",
  fix: "Check that the collector is running, then retry.",
  requestId: "req_e2e"
};

export const renderShellState = (root: Root, params: URLSearchParams) => {
  const locale = pickLocale(params.get("lang") ?? "en");
  document.documentElement.lang = locale;
  const copy = COPY[locale];
  const state = params.get("shell");
  const views: Record<string, [string, () => ReactNode]> = {
    "sign-in": [copy.signIn, () => createElement(TokenForm, { copy, onSignedIn: () => undefined })],
    unreachable: [
      copy.signIn,
      () =>
        createElement(CollectorUnreachable, { copy, collectorUrl: "http://collector:4000", onRetry: () => undefined })
    ],
    "projects-empty": [copy.projects, () => createElement(ProjectsEmpty, { copy, createHref: "?shell=new-project" })],
    "new-project": [
      copy.newProject,
      () => createElement(Onboarding, { copy, publicCollectorUrl: window.location.origin })
    ],
    waiting: [copy.newProject, () => createElement(LiveCheck, { copy, received: false })],
    received: [copy.newProject, () => createElement(LiveCheck, { copy, received: true, pagesHref: "?project=p1" })],
    error: [
      copy.projects,
      () =>
        createElement(ErrorPanel, {
          copy,
          error: SAMPLE_ERROR,
          onRetry: () => ((window as unknown as Record<string, number>).__retries = 1)
        })
    ],
    loading: ["Heat Tracker", () => createElement("div", { className: "skeleton-card", "aria-busy": "true" })]
  };
  const [heading, view] = views[state ?? ""] ?? views.loading;
  root.render(createElement(AppShell, { copy, heading, current: null, pagesHref: "?project=p1", children: view() }));
};
