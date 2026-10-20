import { NextResponse } from "next/server";
import { frameSrcPolicy } from "./lib/frame-handshake";
import { allowedSiteOrigins } from "./lib/frame-policy";

let policy: string | undefined;

/** Sends `Content-Security-Policy: frame-src <HEAT_DASHBOARD_SITE_ORIGINS>` on every dashboard response. */
export function middleware() {
  // The allowlist is read once, so an invalid entry is warned about once rather than on every request.
  policy ??= frameSrcPolicy(allowedSiteOrigins());
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
