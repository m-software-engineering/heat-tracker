import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyJwt } from "./jwt";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };

let urlSeq = 0;
const configFor = () => ({
  jwksUrl: `https://example.com/jwks-${++urlSeq}.json`,
  issuer: "https://example.com",
  audience: "heat-tracker"
});

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

const sign = (claims: Record<string, unknown>, key = privateKey, kid = "k1") => {
  const head = `${encode({ alg: "RS256", kid })}.${encode(claims)}`;
  return `${head}.${crypto.sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
};

const validClaims = () => ({ iss: "https://example.com", aud: "heat-tracker", sub: "u1", exp: now() + 60 });

const serveJwks = (response: Partial<Response> = { ok: true, json: async () => ({ keys: [jwk] }) }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response as Response)
  );

afterEach(() => vi.unstubAllGlobals());

describe("verifyJwt", () => {
  it("accepts a valid token", async () => {
    serveJwks();
    await expect(verifyJwt(sign(validClaims()), configFor())).resolves.toMatchObject({ sub: "u1" });
  });

  it.each([
    ["not-a-jwt", "HEAT_E_JWT_MALFORMED", "3 dot-separated segments"],
    ["a.b.c", "HEAT_E_JWT_MALFORMED", "base64url JSON"],
    [`${encode({ alg: "HS256" })}.${encode({})}.sig`, "HEAT_E_JWT_ALG", 'alg is "HS256"']
  ])("rejects %s before fetching keys", async (token, code, cause) => {
    serveJwks();
    const err = await verifyJwt(token, configFor()).catch((e) => e);
    expect(err).toMatchObject({ code, status: 401 });
    expect(err.cause).toContain(cause);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports JWKS download failures", async () => {
    serveJwks({ ok: false, status: 503 });
    const err = await verifyJwt(sign(validClaims()), configFor()).catch((e) => e);
    expect(err).toMatchObject({ code: "HEAT_E_AUTH_JWKS_UNAVAILABLE", status: 503 });
    expect(err.cause).toContain("HTTP 503");
  });

  it("reports JWKS network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED")))
    );
    await expect(verifyJwt(sign(validClaims()), configFor())).rejects.toMatchObject({
      code: "HEAT_E_AUTH_JWKS_UNAVAILABLE"
    });
  });

  it("reports a missing key", async () => {
    serveJwks({ ok: true, json: async () => ({ keys: [] }) });
    await expect(verifyJwt(sign(validClaims()), configFor())).rejects.toMatchObject({
      code: "HEAT_E_JWKS_KEY_NOT_FOUND"
    });
  });

  it("rejects an unknown kid instead of falling back to the first key", async () => {
    serveJwks();
    const config = configFor();
    const err = await verifyJwt(sign(validClaims(), privateKey, "rotated-away"), config).catch((e) => e);
    expect(err).toMatchObject({ code: "HEAT_E_JWKS_KEY_NOT_FOUND", cause: 'no JWKS key for kid "rotated-away"' });
    expect(err.internal).toEqual({ jwksUrl: config.jwksUrl });
    // Cached path behaves the same.
    await expect(verifyJwt(sign(validClaims(), privateKey, "rotated-away"), config)).rejects.toMatchObject({
      code: "HEAT_E_JWKS_KEY_NOT_FOUND"
    });
  });

  it("keeps the JWKS URL out of the client-facing cause", async () => {
    serveJwks({ ok: false, status: 503 });
    const config = configFor();
    const err = await verifyJwt(sign(validClaims()), config).catch((e) => e);
    expect(err.cause).toBe("JWKS returned HTTP 503");
    expect(JSON.stringify(err)).not.toContain(config.jwksUrl);
    expect(err.internal).toEqual({ jwksUrl: config.jwksUrl });
  });

  it.each([
    ["HEAT_E_JWT_BAD_SIGNATURE", () => sign(validClaims(), other.privateKey), "does not verify"],
    ["HEAT_E_JWT_EXPIRED", () => sign({ ...validClaims(), exp: now() - 10 }), "is before now"],
    ["HEAT_E_JWT_NOT_ACTIVE", () => sign({ ...validClaims(), nbf: now() + 600 }), "is after now"],
    ["HEAT_E_JWT_ISSUER", () => sign({ ...validClaims(), iss: "https://evil.example" }), '"https://evil.example"'],
    ["HEAT_E_JWT_AUDIENCE", () => sign({ ...validClaims(), aud: ["other"] }), '["other"]']
  ])("splits failures into %s", async (code, token, cause) => {
    serveJwks();
    const jwt = token();
    const err = await verifyJwt(jwt, configFor()).catch((e) => e);
    expect(err).toMatchObject({ code, status: 401 });
    expect(err.cause).toContain(cause);
    expect(JSON.stringify(err)).not.toContain(jwt);
  });
});
