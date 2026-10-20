import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { GET } from "../examples/nextjs-dashboard/app/api/frame-check/route";
import { MAX_REDIRECTS, allowedSiteOrigins, checkFrame } from "../examples/nextjs-dashboard/lib/frame-policy";

const quiet = () => {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => warnings.push(message) };
};

test.describe("allowedSiteOrigins (HEAT_DASHBOARD_SITE_ORIGINS)", () => {
  test("normalizes origins and drops empty entries and duplicates", () => {
    const { warn, warnings } = quiet();
    expect(allowedSiteOrigins("", warn)).toEqual([]);
    expect(
      allowedSiteOrigins(
        "https://shop.example.com, ,HTTPS://Shop.Example.com:443/,https://shop.example.com:8443,http://a.test",
        warn
      )
    ).toEqual(["https://shop.example.com", "https://shop.example.com:8443", "http://a.test"]);
    expect(warnings).toEqual([]);
  });

  test("malformed entries and wildcards are ignored with a catalog warning, never thrown", () => {
    const { warn, warnings } = quiet();
    const entries = [
      "example.com",
      "*",
      "*.example.com",
      "https://*.example.com",
      "ftp://x.test",
      "https://a.test/path",
      "https://u@a.test"
    ];
    expect(allowedSiteOrigins([...entries, "https://ok.test"].join(","), warn)).toEqual(["https://ok.test"]);
    expect(warnings).toHaveLength(entries.length);
    for (const w of warnings) expect(w).toMatch(/^HEAT_E_FRAME_ORIGIN_INVALID: /);
    expect(warnings[1]).toContain("wildcard, which is not supported");
    expect(warnings[1]).toContain("Wildcards like `*` or `*.example.com` are not supported");
  });
});

const listen = (handler: http.RequestListener) =>
  new Promise<{ origin: string; hits: string[]; close: () => void }>((resolve) => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        hits,
        close: () => server.close()
      })
    );
  });

test.describe("checkFrame redirects", () => {
  test("a redirect to an origin outside the allowlist is not requested", async () => {
    const internal = await listen((_q, r) => r.end("secret"));
    const site = await listen((_q, r) => r.writeHead(302, { location: `${internal.origin}/admin?x=1` }).end());
    try {
      const verdict = await checkFrame(`${site.origin}/go`, "http://dash.test", [site.origin]);
      expect(verdict).toMatchObject({ allowed: false, blocked: false });
      expect(verdict.reason).toContain(`redirects to ${internal.origin}`);
      expect(internal.hits).toEqual([]);
    } finally {
      internal.close();
      site.close();
    }
  });

  test("redirects within the allowlist are revalidated and the final headers decide", async () => {
    const other = await listen((_q, r) => r.writeHead(200, { "x-frame-options": "DENY" }).end());
    const site = await listen((q, r) =>
      q.url === "/go"
        ? r.writeHead(301, { location: "/next" }).end()
        : r.writeHead(302, { location: `${other.origin}/final` }).end()
    );
    try {
      const verdict = await checkFrame(`${site.origin}/go`, "http://dash.test", [site.origin, other.origin]);
      expect(verdict).toEqual({ blocked: true, reason: "X-Frame-Options DENY" });
      expect(site.hits).toEqual(["/go", "/next"]);
      expect(other.hits).toEqual(["/final"]);
    } finally {
      other.close();
      site.close();
    }
  });

  test(`more than ${MAX_REDIRECTS} redirects is unverified`, async () => {
    const site = await listen((q, r) => r.writeHead(302, { location: `${q.url}x` }).end());
    try {
      const verdict = await checkFrame(`${site.origin}/`, "http://dash.test", [site.origin]);
      expect(verdict).toMatchObject({ blocked: false, verified: false });
      expect(site.hits).toHaveLength(MAX_REDIRECTS + 1);
    } finally {
      site.close();
    }
  });
});

test.describe("GET /api/frame-check", () => {
  const call = async (query: string, env?: string) => {
    const saved = process.env.HEAT_DASHBOARD_SITE_ORIGINS;
    if (env === undefined) delete process.env.HEAT_DASHBOARD_SITE_ORIGINS;
    else process.env.HEAT_DASHBOARD_SITE_ORIGINS = env;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const res = await GET(new Request(`http://dash.test/api/frame-check?${query}`));
      return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
    } finally {
      console.warn = warn;
      if (saved === undefined) delete process.env.HEAT_DASHBOARD_SITE_ORIGINS;
      else process.env.HEAT_DASHBOARD_SITE_ORIGINS = saved;
    }
  };

  test("missing or relative url and a bad origin are 400", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("url=/pricing")).status).toBe(400);
    expect((await call(`url=${encodeURIComponent("https://a.test/")}&origin=nope`)).status).toBe(400);
  });

  test("malformed allowlist entries never cause a 500", async () => {
    for (const env of ["example.com", "*", "*.example.com", "https://*.example.com", undefined]) {
      const res = await call(`url=${encodeURIComponent("https://example.com/")}`, env);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ allowed: false, blocked: false });
    }
  });

  test("an allowlisted site is checked with no-store", async () => {
    const site = await listen((_q, r) =>
      r.writeHead(200, { "content-security-policy": "frame-ancestors 'none'" }).end()
    );
    try {
      const res = await call(
        `url=${encodeURIComponent(`${site.origin}/p`)}&origin=http://dash.test`,
        `${site.origin}, *`
      );
      expect(res).toMatchObject({ status: 200, cache: "no-store", body: { blocked: true } });
    } finally {
      site.close();
    }
  });
});
