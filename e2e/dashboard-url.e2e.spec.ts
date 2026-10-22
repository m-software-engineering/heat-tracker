import { test, expect } from "@playwright/test";
import { configuredOrigin } from "../examples/nextjs-dashboard/lib/collector-proxy";
import { register } from "../examples/nextjs-dashboard/instrumentation";

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

  const leaks = [
    "https://u:s3cretPW@dash.example.com",
    "https://u:s3cret#PW@dash.example.com",
    "https://u:s3cret/PW@dash.example.com",
    "https://u:s3cret?PW@dash.example.com",
    "https://u:p@ss3cretPW@dash.example.com",
    "https://s3cretPW@dash.example.com",
    "https://dash.example.com?access_token=s3cret",
    "https://dash.example.com#s3cret",
    "https://u:s3cret%40dash.example.com",
    "https://dash.example.com/\nFORGED s3cret",
    "   ",
    "not-a-url"
  ];

  const boot = (value: string) => {
    const lines: string[] = [];
    const saved = { error: console.error, exit: process.exit, runtime: process.env.NEXT_RUNTIME };
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit;
    process.env.NEXT_RUNTIME = "nodejs";
    let exit = "";
    try {
      withUrl(value, () => {
        try {
          register();
        } catch (error) {
          exit = (error as Error).message;
        }
      });
    } finally {
      console.error = saved.error;
      process.exit = saved.exit;
      if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = saved.runtime;
    }
    return { exit, log: lines.join("\n") };
  };

  for (const value of leaks) {
    test(`boot hides rejected value ${JSON.stringify(value)}`, () => {
      const { exit, log } = boot(value);
      expect(exit).toBe("exit 1");
      expect(log).toContain(`  got:  (hidden, ${value.length} characters)`);
      expect(log).not.toContain("s3cret");
      expect(log).not.toContain("FORGED");
      expect(log.split("\n")).toHaveLength(4);
    });
  }

  test("whitespace shows its length", () => expect(boot("   ").log).toContain("(hidden, 3 characters)"));
});
