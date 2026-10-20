import { test, expect } from "@playwright/test";
import { frameVerdict } from "../examples/nextjs-dashboard/lib/frame-policy";

const DASHBOARD = "https://dash.example.com";
const SITE = "https://shop.example.org/pricing";
const verdict = (headers: Record<string, string>, dashboard = DASHBOARD, site = SITE) =>
  frameVerdict(new Headers(headers), dashboard, site).blocked;

test.describe("frame policy (server-side framing check)", () => {
  test("no headers allows framing", () => {
    expect(verdict({})).toBe(false);
  });

  test("X-Frame-Options DENY and cross-origin SAMEORIGIN block; ALLOW-FROM is ignored like browsers", () => {
    expect(verdict({ "X-Frame-Options": "DENY" })).toBe(true);
    expect(verdict({ "X-Frame-Options": "sameorigin" })).toBe(true);
    expect(verdict({ "X-Frame-Options": "SAMEORIGIN" }, "https://shop.example.org")).toBe(false);
    expect(verdict({ "X-Frame-Options": "ALLOW-FROM https://dash.example.com" })).toBe(false);
  });

  test("frame-ancestors decides and overrides X-Frame-Options", () => {
    expect(verdict({ "Content-Security-Policy": "frame-ancestors 'none'" })).toBe(true);
    expect(verdict({ "Content-Security-Policy": "frame-ancestors 'self'" })).toBe(true);
    expect(verdict({ "Content-Security-Policy": `default-src 'self'; frame-ancestors 'self' ${DASHBOARD}` })).toBe(
      false
    );
    expect(verdict({ "Content-Security-Policy": "frame-ancestors *.example.com", "X-Frame-Options": "DENY" })).toBe(
      false
    );
    expect(verdict({ "Content-Security-Policy": "frame-ancestors https:" })).toBe(false);
    expect(verdict({ "Content-Security-Policy": "frame-ancestors https://dash.example.com:8443" })).toBe(true);
    expect(verdict({ "Content-Security-Policy": "frame-ancestors http://dash.example.com" })).toBe(true);
  });

  test("every policy carrying frame-ancestors must allow the dashboard", () => {
    expect(verdict({ "Content-Security-Policy": `frame-ancestors ${DASHBOARD}, frame-ancestors 'none'` })).toBe(true);
    expect(verdict({ "Content-Security-Policy": `script-src 'self', frame-ancestors ${DASHBOARD}` })).toBe(false);
  });
});
