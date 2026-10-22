/** Pinned SDK release used in the snippet (keep in step with packages/heat-sdk/package.json). */
export const SDK_VERSION = "0.3.0";
export const PROJECT_KEY_STORAGE = "heat-dashboard:projectKey";
/** The name typed on the new-project screen (#29); kept in this browser only, see the PR notes. */
export const PROJECT_NAME_STORAGE = "heat-dashboard:projectName";

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

/** A JS string literal that is also safe inside an HTML <script> (no `<`, so no `</script>`). */
export const scriptString = (value: string) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** `dashboardOrigin` is this dashboard's own origin: the SDK sends its frame handshake only there (#59). */
export const trackingSnippet = (publicCollectorUrl: string, projectKey: string, dashboardOrigin: string) =>
  [
    '<script type="module">',
    `  import { init } from "https://cdn.jsdelivr.net/npm/@m-software-engineering/heat-sdk@${SDK_VERSION}/+esm";`,
    `  init({ endpoint: ${scriptString(`${publicCollectorUrl}/ingest`)}, projectKey: ${scriptString(projectKey)}, dashboardOrigins: [${scriptString(dashboardOrigin)}] });`,
    "</script>"
  ].join("\n");
