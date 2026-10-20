/**
 * Shared privacy rules for stored paths (#25, Margot on #64). This file is kept byte-identical in
 * packages/heat-collector/src/privacy-rules.ts and packages/heat-sdk/src/privacy-rules.ts (a test checks it);
 * both sides run the cases in fixtures/privacy-cases.json.
 */
// A param is sensitive when one of its name tokens (split on `-`, `_` and camelCase) is one of these…
const SENSITIVE_TOKENS = new Set([
  "token",
  "key",
  "secret",
  "password",
  "passwd",
  "auth",
  "sig",
  "signature",
  "jwt",
  "session"
]);
// …or the whole name (lowercase, no `-`/`_`) is one of these. `code` only counts as a whole name.
const SENSITIVE_NAMES = new Set([
  "apikey",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "idtoken",
  "sessionid",
  "sessiontoken",
  "clientsecret",
  "xamzsignature",
  "code",
  "otp",
  "authcode",
  "verificationcode"
]);
const FILE_EXTENSIONS = new Set(
  "png jpg jpeg gif svg webp avif bmp ico js mjs cjs ts css map json html htm xml txt pdf woff woff2 ttf otf eot mp4 webm mp3 wasm zip".split(
    " "
  )
);
const EMAIL = /^[^\s@/]+@[^\s@/]+\.([a-z]{2,})$/i;

/** Email-looking: local@domain.tld with an alphabetic TLD that is not a file extension (keeps logo@2x.png). */
export const isEmailLike = (text: string) => {
  const match = EMAIL.exec(text.trim());
  return match !== null && !FILE_EXTENSIONS.has(match[1].toLowerCase());
};

/** Path-correct decoding (`+` stays `+`); on a malformed escape, valid %XX runs are still decoded. */
export const decodeLenient = (text: string): { text: string; ok: boolean } => {
  try {
    return { text: decodeURIComponent(text), ok: true };
  } catch {
    const best = text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    return { text: best, ok: false };
  }
};

/** Name as compared: decoded, NFKC-normalized, lowercased. */
export const normalizeParamName = (raw: string) => decodeLenient(raw).text.normalize("NFKC").trim().toLowerCase();

/** A param name that cannot be decoded is treated as sensitive (dropped). */
export const isSensitiveParamName = (raw: string) => {
  const decoded = decodeLenient(raw);
  if (!decoded.ok) return true;
  const name = decoded.text.normalize("NFKC").trim();
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/);
  return tokens.some((t) => SENSITIVE_TOKENS.has(t)) || SENSITIVE_NAMES.has(name.toLowerCase().replace(/[-_]/g, ""));
};

/** A raw `name=value` pair is dropped when its name is sensitive or its value looks like an email. */
export const isSensitivePair = (pair: string) => {
  const eq = pair.indexOf("=");
  const name = eq < 0 ? pair : pair.slice(0, eq);
  const value = eq < 0 ? "" : decodeLenient(pair.slice(eq + 1)).text;
  return isSensitiveParamName(name) || isEmailLike(value);
};

/** Drops `;matrix` params from every segment and replaces email-looking segments with `[email]`. */
export const sanitizePathname = (pathname: string) =>
  pathname
    .split("/")
    .map((segment) => {
      const bare = segment.split(";")[0];
      return isEmailLike(decodeLenient(bare).text) ? "[email]" : bare;
    })
    .join("/");
