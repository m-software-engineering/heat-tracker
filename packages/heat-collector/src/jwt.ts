import crypto from "crypto";

export type JwtConfig = {
  jwksUrl: string;
  issuer: string;
  audience: string;
};

type Jwk = {
  kty: string;
  kid: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
};

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
};

const cache: Record<string, { fetchedAt: number; keys: Record<string, Jwk> }> = {};

const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
};

const decodeJson = <T>(input: string): T => {
  const decoded = base64UrlDecode(input).toString("utf8");
  return JSON.parse(decoded) as T;
};

const getJwk = async (jwksUrl: string, kid?: string): Promise<Jwk | null> => {
  const entry = cache[jwksUrl];
  const now = Date.now();
  if (entry && now - entry.fetchedAt < 5 * 60 * 1000) {
    if (kid && entry.keys[kid]) return entry.keys[kid];
    return Object.values(entry.keys)[0] || null;
  }

  const res = await fetch(jwksUrl);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { keys: Jwk[] };
  const keys: Record<string, Jwk> = {};
  for (const key of data.keys || []) {
    if (key.kid) keys[key.kid] = key;
  }
  cache[jwksUrl] = { fetchedAt: now, keys };
  if (kid && keys[kid]) return keys[kid];
  return Object.values(keys)[0] || null;
};

export const verifyJwt = async (token: string, config: JwtConfig): Promise<JwtPayload> => {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("Invalid JWT format");
  }

  const header = decodeJson<JwtHeader>(headerB64);
  const payload = decodeJson<JwtPayload>(payloadB64);

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported JWT alg: ${header.alg}`);
  }

  const jwk = await getJwk(config.jwksUrl, header.kid);
  if (!jwk) {
    throw new Error("JWKS key not found");
  }

  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const keyObject = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  const valid = crypto.verify("RSA-SHA256", data, keyObject, signature);
  if (!valid) {
    throw new Error("JWT signature invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("JWT expired");
  }
  if (payload.nbf && payload.nbf > now) {
    throw new Error("JWT not active");
  }

  if (config.issuer && payload.iss !== config.issuer) {
    throw new Error("JWT issuer mismatch");
  }
  if (config.audience) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(config.audience) : aud === config.audience;
    if (!ok) {
      throw new Error("JWT audience mismatch");
    }
  }

  return payload;
};
