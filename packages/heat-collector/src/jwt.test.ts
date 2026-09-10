import { describe, expect, it } from "vitest";
import { verifyJwt } from "./jwt";

const config = {
  jwksUrl: "https://example.com/.well-known/jwks.json",
  issuer: "https://example.com",
  audience: "heat-tracker"
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("verifyJwt", () => {
  it("rejects malformed tokens", async () => {
    await expect(verifyJwt("not-a-jwt", config)).rejects.toThrow("Invalid JWT format");
  });

  it("rejects algorithms other than RS256 before fetching keys", async () => {
    const token = `${encode({ alg: "HS256" })}.${encode({ iss: config.issuer, aud: config.audience })}.signature`;

    await expect(verifyJwt(token, config)).rejects.toThrow("Unsupported JWT alg: HS256");
  });
});
