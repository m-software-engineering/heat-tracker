import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { init } from "./index";

const ENDPOINT = "http://localhost:4000/ingest";
const quiet = { click: true, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false };

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

const sentEvents = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.flatMap((call) => JSON.parse(call[1].body).events);

describe("flush on page exit (#28)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDnt = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");

  beforeEach(() => {
    document.body.innerHTML = `<button id="leave">Leave</button>`;
    localStorage.clear();
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
    Object.defineProperty(Navigator.prototype, "doNotTrack", { value: "0", configurable: true });
    setVisibility("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDnt) Object.defineProperty(Navigator.prototype, "doNotTrack", originalDnt);
    setVisibility("visible");
  });

  it("sends the last click synchronously with keepalive on pagehide, before the flush interval", async () => {
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    document.getElementById("leave")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(request.keepalive).toBe(true);
    expect(request.headers["x-project-key"]).toBe("test-key");
    expect(sentEvents(fetchMock).map((e: any) => e.type)).toEqual(["click"]);
    await tracker.shutdown();
  });

  it("flushes on visibilitychange to hidden but not to visible, and sends each event once", async () => {
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    tracker.track("before-hide");

    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents(fetchMock).map((e: any) => e.name)).toEqual(["before-hide"]);
    await tracker.shutdown();
  });

  it("splits a large queue into requests under the keepalive body limit", async () => {
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    const big = "x".repeat(5_000);
    for (let i = 0; i < 30; i += 1) tracker.track(`e${i}`, { big });

    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const [, request] of fetchMock.mock.calls) expect(request.body.length).toBeLessThan(64 * 1024);
    expect(sentEvents(fetchMock)).toHaveLength(30);
    await tracker.shutdown();
  });

  it("still flushes on exit while a retry backoff is pending", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet, onError: () => {} });
    tracker.track("first");
    await tracker.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events.map((e: any) => e.name)).toEqual(["first"]);
    await tracker.shutdown();
  });

  it("sends nothing on exit with Do Not Track on", () => {
    Object.defineProperty(Navigator.prototype, "doNotTrack", { value: "1", configurable: true });
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    tracker.track("dnt");
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops listening after shutdown", async () => {
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    await tracker.shutdown();
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs one debug line per exit in debug mode", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet, debug: true });
    tracker.track("a");
    tracker.track("b");
    window.dispatchEvent(new Event("pagehide"));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("heat-sdk: flushed 2 events via fetch keepalive on pagehide");
    await tracker.shutdown();
  });
});
