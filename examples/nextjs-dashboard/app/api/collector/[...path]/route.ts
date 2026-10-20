import { collectorGet, readAdminToken, signedOutResponse } from "../../../../lib/collector-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/collector/api/<...> → collector GET /api/<...> with the admin token from the HttpOnly
 * cookie. Read-only, and only the collector's /api/* read routes, so it cannot reach anything else.
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path[0] !== "api" || path.some((segment) => segment === ".." || segment === "")) {
    return new Response(null, { status: 404 });
  }
  const token = readAdminToken(request);
  if (!token) return signedOutResponse();
  const search = new URL(request.url).search;
  return collectorGet(`/${path.map(encodeURIComponent).join("/")}${search}`, token);
}
