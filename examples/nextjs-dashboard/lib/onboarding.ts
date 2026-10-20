/** Pinned SDK release used in the snippet (keep in step with packages/heat-sdk/package.json). */
export const SDK_VERSION = "0.3.0";
export const PROJECT_KEY_STORAGE = "heat-dashboard:projectKey";

export type ProjectSummary = { id: string; name: string; createdAt: number };
export type SessionState = {
  signedIn: boolean;
  collectorUrl: string;
  publicCollectorUrl: string;
  error?: { code: string; message: string; cause: string; fix: string; docs: string };
};

/** 128 random bits; the collector creates the project when the first event with this key arrives. */
export const generateProjectKey = (random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)) => {
  const bytes = random(new Uint8Array(16));
  return `pk_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
};

export const trackingSnippet = (publicCollectorUrl: string, projectKey: string) =>
  [
    '<script type="module">',
    `  import { init } from "https://cdn.jsdelivr.net/npm/@m-software-engineering/heat-sdk@${SDK_VERSION}/+esm";`,
    `  init({ endpoint: "${publicCollectorUrl}/ingest", projectKey: "${projectKey}" });`,
    "</script>"
  ].join("\n");

/** Live state under the snippet. */
export const receivingLabel = (project: ProjectSummary | null) =>
  project ? `Receiving events from ${project.name}` : "Waiting for your first event…";
