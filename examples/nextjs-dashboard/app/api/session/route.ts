import {
  adminCookie,
  clearedAdminCookie,
  collectorGet,
  collectorUrl,
  errorResponse,
  publicCollectorUrl,
  readAdminToken,
  unreachableError
} from "../../../lib/collector-proxy";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * GET → `{ signedIn, collectorUrl, publicCollectorUrl }`, plus `error` when the collector cannot
 * be reached or rejects the stored token (the cookie is then cleared).
 */
export async function GET(request: Request) {
  const token = readAdminToken(request);
  const urls = { collectorUrl: collectorUrl(), publicCollectorUrl: publicCollectorUrl() };
  const probe = await collectorGet("/api/metrics", token ?? "");
  if (probe.status === 502) {
    const body = await probe.json();
    return Response.json({ signedIn: false, ...urls, error: body.error }, { headers: noStore });
  }
  if (!token) return Response.json({ signedIn: false, ...urls }, { headers: noStore });
  if (probe.ok) return Response.json({ signedIn: true, ...urls }, { headers: noStore });
  const body = await probe.json().catch(() => null);
  return Response.json(
    { signedIn: false, ...urls, error: body?.error },
    { headers: { ...noStore, "Set-Cookie": clearedAdminCookie() } }
  );
}

/** POST `{ token }`: checks it against the collector, then stores it in the HttpOnly cookie. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const probe = await collectorGet("/api/metrics", token);
  if (probe.status === 502) return probe;
  if (!probe.ok) {
    const upstream = await probe.json().catch(() => null);
    return errorResponse(upstream?.error ?? unreachableError(`collector answered HTTP ${probe.status}`), probe.status);
  }
  return Response.json({ signedIn: true }, { headers: { ...noStore, "Set-Cookie": adminCookie(request, token) } });
}

export async function DELETE() {
  return Response.json({ signedIn: false }, { headers: { ...noStore, "Set-Cookie": clearedAdminCookie() } });
}
