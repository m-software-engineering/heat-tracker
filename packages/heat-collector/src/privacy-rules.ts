/**
 * Shared privacy rules for stored paths (#25, Margot on #64). This file is kept byte-identical in
 * packages/heat-collector/src/privacy-rules.ts, packages/heat-sdk/src/privacy-rules.ts and
 * examples/nextjs-dashboard/lib/privacy-rules.ts (frame handshake, #59; tests check it);
 * the packages run the cases in fixtures/privacy-cases.json.
 */
// Margot's final rule (#64). The lists are frozen: a new case needs a fixture and its own issue.
// 1. A token (split on - _ [ ] . + space, camelCase and digit/letter boundaries) is one of these:
const SENSITIVE_TOKENS = new Set(
  (
    "token key secret password passwd auth authorization sig signature jwt session bearer cookie credential " +
    "credentials csrf xsrf nonce hmac pwd pass passcode otp ssn ticket assertion samlresponse"
  ).split(" ")
);
// 2. Or the whole name without separators is one of these compounds:
const SENSITIVE_NAMES = new Set(
  (
    "apikey accesstoken authtoken refreshtoken idtoken sessionid sessiontoken clientsecret xamzsignature sid pin " +
    "jsessionid phpsessid oauthverifier policy oobcode otpcode code authcode verificationcode"
  ).split(" ")
);
// 3. Or a token ends in token/secret/sessid, or is <one of these>key (secretkey; not turkey or monkey).
const SENSITIVE_SUFFIXES = ["token", "secret", "sessid"];
const KEY_PREFIXES = new Set(["secret", "private", "access", "api", "my", "client", "session"]);
const FILE_EXTENSIONS = new Set(
  (
    "png jpg jpeg gif svg webp avif bmp ico heic heif tiff tif js mjs cjs ts css map json html htm xml txt csv tsv " +
    "pdf doc docx xls xlsx ppt pptx rtf woff woff2 ttf otf eot mp4 m4v mov avi mkv webm mp3 m4a wav ogg flac aac " +
    "wasm zip gz tgz bz2 xz rar 7z dmg iso apk exe bin log yaml yml toml"
  ).split(" ")
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

const isSensitiveToken = (token: string) => {
  if (SENSITIVE_TOKENS.has(token) || SENSITIVE_SUFFIXES.some((suffix) => token.endsWith(suffix))) return true;
  return token.endsWith("key") && KEY_PREFIXES.has(token.slice(0, -3));
};

/** A param name that cannot be decoded is treated as sensitive (dropped). */
export const isSensitiveParamName = (raw: string) => {
  const decoded = decodeLenient(raw);
  if (!decoded.ok) return true;
  const name = decoded.text.normalize("NFKC").trim();
  const tokens = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(?=[0-9])/g, "$1 ")
    .replace(/([0-9])(?=[a-zA-Z])/g, "$1 ")
    .toLowerCase()
    .split(/[\s_\-[\].+]+/)
    .filter(Boolean);
  const whole = tokens.join("");
  return SENSITIVE_NAMES.has(whole) || SENSITIVE_TOKENS.has(whole) || tokens.some(isSensitiveToken);
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
