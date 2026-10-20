import { allowedSiteOrigins, checkFrame } from "../../../lib/frame-policy";

/**
 * GET /api/frame-check?url=<site page>&origin=<dashboard origin> → FrameVerdict plus `allowedOrigins`
 * (the allowlist, so the client can accept a frame handshake from an allowlisted redirect target).
 * Server-side because a blocked frame is indistinguishable from an allowed cross-origin frame in the
 * browser. Only response headers are read; the body is discarded and never returned.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const origin = params.get("origin") || new URL(request.url).origin;
  if (!url || !URL.canParse(url)) {
    return Response.json({ blocked: true, reason: "url is missing or not absolute" }, { status: 400 });
  }
  if (!URL.canParse(origin)) {
    return Response.json({ blocked: true, reason: "origin is not absolute" }, { status: 400 });
  }
  const allowedOrigins = allowedSiteOrigins();
  return Response.json(
    { ...(await checkFrame(url, new URL(origin).origin, allowedOrigins)), allowedOrigins },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
