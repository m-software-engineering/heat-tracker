import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decodeLenient, isSensitiveParamName } from "./privacy-rules";

// Frozen copy of the param-name rule at 65d8344 (#64). Changes to privacy-rules.ts may only remove its false
// positives: every name it dropped must keep dropping unless it is on EXPLICIT_KEEPS (Ines's QA on #92).
const OLD_TOKENS = new Set(
  (
    "token key secret password passwd auth authorization sig signature jwt session bearer cookie credential " +
    "credentials csrf xsrf nonce hmac pwd pass passcode otp ssn ticket assertion samlresponse"
  ).split(" ")
);
const OLD_NAMES = new Set(
  (
    "apikey accesstoken authtoken refreshtoken idtoken sessionid sessiontoken clientsecret xamzsignature sid pin " +
    "jsessionid phpsessid oauthverifier policy oobcode otpcode code authcode verificationcode"
  ).split(" ")
);
const OLD_SUFFIXES = ["token", "secret", "sessid"];
const OLD_KEY_PREFIXES = new Set(["secret", "private", "access", "api", "my", "client", "session"]);
const oldIsSensitive = (raw: string) => {
  const decoded = decodeLenient(raw);
  if (!decoded.ok) return true;
  const tokens = decoded.text
    .normalize("NFKC")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(?=[0-9])/g, "$1 ")
    .replace(/([0-9])(?=[a-zA-Z])/g, "$1 ")
    .toLowerCase()
    .split(/[\s_\-[\].+]+/)
    .filter(Boolean);
  const whole = tokens.join("");
  return (
    OLD_NAMES.has(whole) ||
    OLD_TOKENS.has(whole) ||
    tokens.some(
      (t) =>
        OLD_TOKENS.has(t) ||
        OLD_SUFFIXES.some((s) => t.endsWith(s)) ||
        (t.endsWith("key") && OLD_KEY_PREFIXES.has(t.slice(0, -3)))
    )
  );
};

const EXPLICIT_KEEPS = new Set(
  "primary_key sort_key cache-key key_id ticket_id session_count boarding_pass pass_type publishable_key client_id".split(
    " "
  )
);
// Extra sensitive names beyond the fixture file, including camelCase variants that stay out of scope.
const SENSITIVE_EXTRAS = (
  "key KEY Key api_key apiKey session_id sessionId ticketId sessionCount keyId primaryKey sortKey boardingPass " +
  "passType ticket_count key_count session_key session_token token_id id_token password pass passwd pass_word " +
  "stripe_key license_key user_key pass_id key-id ticket-id session-count primary-key"
).split(" ");

const cases = JSON.parse(readFileSync(path.join(__dirname, "../../../fixtures/privacy-cases.json"), "utf8")) as {
  params: { drop: string[]; keep: string[] };
};
const names = [...new Set([...cases.params.drop, ...cases.params.keep, ...SENSITIVE_EXTRAS])];

describe("privacy guardrail: only removes 65d8344 false positives", () => {
  it.each(names.filter(oldIsSensitive))("still drops %s (unless explicitly kept)", (name) => {
    expect(isSensitiveParamName(name)).toBe(!EXPLICIT_KEEPS.has(name));
  });

  it("the frozen rule matches the fixtures' drop list", () => {
    expect(cases.params.drop.filter((name) => !oldIsSensitive(name))).toEqual([]);
  });
});
