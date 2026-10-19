import crypto from "crypto";
import { HeatTrackerError, INGEST_ERRORS } from "@m-software-engineering/heat-errors";

function fail(code: keyof typeof INGEST_ERRORS, cause: string): never {
  throw new HeatTrackerError(INGEST_ERRORS[code], cause);
}

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

  let res: Response;
  try {
    res = await fetch(jwksUrl);
  } catch (err) {
    throw new HeatTrackerError(INGEST_ERRORS.HEAT_E_JWKS_FETCH, `GET ${jwksUrl} failed: network error`, {
      original: err
    });
  }
  if (!res.ok) {
    fail("HEAT_E_JWKS_FETCH", `GET ${jwksUrl} returned HTTP ${res.status}`);
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
    fail("HEAT_E_JWT_MALFORMED", "token does not have 3 dot-separated segments");
  }

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeJson<JwtHeader>(headerB64);
    payload = decodeJson<JwtPayload>(payloadB64);
  } catch {
    return fail("HEAT_E_JWT_MALFORMED", "header or payload segment is not base64url JSON");
  }

  if (header.alg !== "RS256") {
    fail("HEAT_E_JWT_ALG", `alg is ${JSON.stringify(header.alg)}, expected "RS256"`);
  }

  const jwk = await getJwk(config.jwksUrl, header.kid);
  if (!jwk) {
    return fail(
      "HEAT_E_JWKS_KEY_NOT_FOUND",
      `no key for kid ${JSON.stringify(header.kid ?? null)} at ${config.jwksUrl}`
    );
  }

  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const keyObject = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  const valid = crypto.verify("RSA-SHA256", data, keyObject, signature);
  if (!valid) {
    fail("HEAT_E_JWT_BAD_SIGNATURE", `RS256 signature does not verify with kid ${JSON.stringify(jwk.kid)}`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    fail("HEAT_E_JWT_EXPIRED", `exp=${payload.exp} is before now=${now}`);
  }
  if (payload.nbf && payload.nbf > now) {
    fail("HEAT_E_JWT_NOT_ACTIVE", `nbf=${payload.nbf} is after now=${now}`);
  }

  if (config.issuer && payload.iss !== config.issuer) {
    fail(
      "HEAT_E_JWT_ISSUER",
      `iss is ${JSON.stringify(payload.iss ?? null)}, expected ${JSON.stringify(config.issuer)}`
    );
  }
  if (config.audience) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(config.audience) : aud === config.audience;
    if (!ok) {
      fail("HEAT_E_JWT_AUDIENCE", `aud is ${JSON.stringify(aud ?? null)}, expected ${JSON.stringify(config.audience)}`);
    }
  }

  return payload;
};
