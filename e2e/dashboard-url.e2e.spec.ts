import { test, expect } from "@playwright/test";
import { configuredOrigin, redactUserinfo } from "../examples/nextjs-dashboard/lib/collector-proxy";

const withUrl = (value: string | undefined, run: () => void) => {
  const saved = process.env.HEAT_DASHBOARD_URL;
  if (value === undefined) delete process.env.HEAT_DASHBOARD_URL;
  else process.env.HEAT_DASHBOARD_URL = value;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.HEAT_DASHBOARD_URL;
    else process.env.HEAT_DASHBOARD_URL = saved;
  }
};

test.describe("HEAT_DASHBOARD_URL", () => {
  for (const [value, origin] of [
    [undefined, undefined],
    ["", undefined],
    ["https://dash.example.com", "https://dash.example.com"],
    ["HTTPS://Dash.Example.com", "https://dash.example.com"],
    ["http://localhost:3000", "http://localhost:3000"]
  ] as const) {
    test(`accepts ${JSON.stringify(value)}`, () => withUrl(value, () => expect(configuredOrigin()).toBe(origin)));
  }

  for (const value of [
    "   ",
    " https://dash.example.com",
    "not-a-url",
    "data:",
    "ftp://dash.example.com",
    "https://dash.example.com/",
    "https://dash.example.com/app",
    "https://dash.example.com:443",
    "https://dash.example.com.",
    "https://u:p@dash.example.com"
  ]) {
    test(`rejects ${JSON.stringify(value)}`, () =>
      withUrl(value, () => expect(() => configuredOrigin()).toThrow(/not a valid origin/)));
  }

  for (const secret of ["s3cret#PW", "s3cret/PW", "s3cret?PW", "p@ss3cretPW"]) {
    test(`never prints the password ${JSON.stringify(secret)}`, () =>
      withUrl(`https://u:${secret}@dash.example.com`, () => {
        let cause = "";
        try {
          configuredOrigin();
        } catch (error) {
          cause = String((error as { cause: unknown }).cause);
        }
        expect(cause).toBe("https://***:***@dash.example.com");
        expect(cause).not.toContain("s3cret");
      }));
  }

  test("masks a username-only credential", () =>
    expect(redactUserinfo("https://s3cretPW@dash.example.com")).toBe("https://***@dash.example.com"));
});
