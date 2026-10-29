import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { init as Init } from "./index";
let init: typeof Init;
import { KEEPALIVE_MAX_BODY_BYTES } from "./page-exit";

const ENDPOINT = "http://localhost:4000/ingest";
const quiet = { click: true, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false };

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

const sentEvents = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.flatMap((call) => JSON.parse(call[1].body).events);

describe("flush on page exit (#28)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDnt = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");

  beforeEach(async () => {
    // A fresh module graph represents a new page lifetime (and keepalive budget).
    vi.resetModules();
    ({ init } = await import("./index"));
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

  it("keeps the UTF-8 bytes of all keepalive bodies started on exit under the shared limit", async () => {
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    const big = "日本語".repeat(400);
    for (let i = 0; i < 40; i += 1) tracker.track(`e${i}`, { big });

    window.dispatchEvent(new Event("pagehide"));
    // Another signal, even after the requests settle, cannot reset the lifetime budget.
    await Promise.resolve();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    const bytes = (body: string) => new TextEncoder().encode(body).length;
    const exitBodies = fetchMock.mock.calls.map(([, request]) => request.body as string);
    expect(exitBodies.length).toBeGreaterThan(0);
    expect(exitBodies.reduce((sum, body) => sum + bytes(body), 0)).toBeLessThanOrEqual(KEEPALIVE_MAX_BODY_BYTES);
    // What did not fit stays queued and goes out on the next flush, each event once.
    await tracker.flush();
    expect(new Set(sentEvents(fetchMock).map((e: any) => e.name)).size).toBe(40);
    expect(sentEvents(fetchMock)).toHaveLength(40);
    await tracker.shutdown();
  });

  it("persists an oversized event on exit while sending smaller events", async () => {
    const onError = vi.fn();
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet, onError });
    tracker.track("huge", { big: "x".repeat(KEEPALIVE_MAX_BODY_BYTES) });
    tracker.track("small");
    window.dispatchEvent(new Event("pagehide"));
    expect(sentEvents(fetchMock).map((e: any) => e.name)).toEqual(["small"]);
    expect(onError).not.toHaveBeenCalled();
    await Promise.resolve();
    const key = Object.keys(sessionStorage).find((key) => key.endsWith(":queue"))!;
    expect(JSON.parse(sessionStorage.getItem(key)!).map((e: any) => e.name)).toEqual(["huge"]);
    await tracker.shutdown();
  });

  it("shares the lifetime budget across trackers", async () => {
    const trackers = ["one", "two"].map((projectKey) => init({ endpoint: ENDPOINT, projectKey, capture: quiet }));
    for (const tracker of trackers) tracker.track("big", { data: "x".repeat(35_000) });
    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    await Promise.all(trackers.map((tracker) => tracker.shutdown()));
  });

  it.each(["rejection", "throw"])("does not repeat an exit event after a fetch %s", async (failure) => {
    if (failure === "rejection") fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    else
      fetchMock.mockImplementationOnce(() => {
        throw new TypeError("offline");
      });
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet });
    tracker.track("once");
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sentEvents(fetchMock).map((e: any) => e.name)).toEqual(["once"]);
    await tracker.shutdown();
  });

  it("sends a lone event over the limit without keepalive while the page stays open", async () => {
    const onError = vi.fn();
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet, onError });
    tracker.track("huge", { big: "x".repeat(KEEPALIVE_MAX_BODY_BYTES) });
    await tracker.flush();
    expect(sentEvents(fetchMock).map((e: any) => e.name)).toEqual(["huge"]);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    await tracker.shutdown();
  });

  it("logs one debug line per exit in debug mode", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const tracker = init({ endpoint: ENDPOINT, projectKey: "test-key", capture: quiet, debug: true });
    tracker.track("a");
    tracker.track("b");
    window.dispatchEvent(new Event("pagehide"));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("heat-sdk: flushed 2/2 events via fetch keepalive on pagehide");
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
});
