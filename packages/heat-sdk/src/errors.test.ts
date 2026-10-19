import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, isHeatError, type HeatError } from "./index";

const collectorError: HeatError = {
  code: "HEAT_E_JWT_EXPIRED",
  message: "The JWT has expired.",
  cause: "exp=1 is before now=2",
  fix: "Refresh the token and call tracker.setAuthToken(newJwt).",
  docs: "https://github.com/m-software-engineering/heat-tracker/blob/main/docs/errors.md#heat_e_jwt_expired",
  status: 401,
  requestId: "rid-1"
};

const start = (extra: Record<string, unknown> = {}) =>
  init({
    endpoint: "http://localhost:4000/ingest",
    projectKey: "test-key",
    capture: { pageview: false },
    ...extra
  });

describe("heat-sdk errors", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names the missing config key", () => {
    let thrown: unknown;
    try {
      init({ endpoint: "http://localhost/ingest", projectKey: "" });
    } catch (err) {
      thrown = err;
    }
    expect(isHeatError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: "HEAT_E_CONFIG_MISSING", cause: "projectKey is missing" });
  });

  it("passes the collector HeatError to onError and keeps the batch for retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: collectorError }) });
    const onError = vi.fn();
    const tracker = start({ onError });

    tracker.track("evt");
    await tracker.flush();

    expect(onError).toHaveBeenCalledWith(collectorError);
    await tracker.shutdown().catch(() => {});
  });

  it("falls back to HEAT_E_INGEST_HTTP for non-JSON responses and network errors", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => Promise.reject(new SyntaxError("x")) });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onError = vi.fn();
    const tracker = start({ onError });

    tracker.track("evt");
    await tracker.flush();
    await vi.advanceTimersByTimeAsync(2000);

    expect(onError.mock.calls.map(([e]) => [e.code, e.cause])).toEqual([
      ["HEAT_E_INGEST_HTTP", "collector returned HTTP 502"],
      ["HEAT_E_INGEST_NETWORK", "fetch failed: Failed to fetch"]
    ]);
  });

  it("is silent by default and logs each code once with debug", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: collectorError }) });

    const quiet = start();
    quiet.track("evt");
    await quiet.flush();
    expect(warn).not.toHaveBeenCalled();

    const loud = start({
      debug: true,
      onError: () => {
        throw new Error("host bug");
      }
    });
    loud.track("evt");
    await loud.flush();
    await vi.advanceTimersByTimeAsync(5000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("HEAT_E_JWT_EXPIRED: The JWT has expired.");
    expect(warn.mock.calls[0][0]).toContain("Fix: Refresh the token");
  });
});
