import { allowedSiteOrigins, checkFrame } from "../../../lib/frame-policy";

/**
 * GET /api/frame-check?url=<site page>&origin=<dashboard origin> → { blocked, reason }.
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
  return Response.json(await checkFrame(url, origin, allowedSiteOrigins()), {
    headers: { "Cache-Control": "no-store" }
  });
}
