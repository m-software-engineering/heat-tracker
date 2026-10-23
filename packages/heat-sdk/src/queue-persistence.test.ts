import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { init as Init } from "./index";

const config = {
  endpoint: "http://localhost:4000/ingest",
  projectKey: "queue-test",
  capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false }
};
const queueKeys = (storage: Storage) => Object.keys(storage).filter((key) => key.endsWith(":queue"));
const persisted = (storage: Storage) => queueKeys(storage).flatMap((key) => JSON.parse(storage.getItem(key)!));

describe("queue persistence", () => {
  let init: typeof Init;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ init } = await import("./index"));
    sessionStorage.clear();
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("replays an unacknowledged exit batch from sessionStorage on reload", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const first = init(config);
    first.track("reload-me");
    window.dispatchEvent(new Event("pagehide"));
    const [event] = persisted(sessionStorage);
    expect(event.name).toBe("reload-me");
    expect(queueKeys(localStorage)).toEqual([]);
    // The page disappears without an acknowledgement; the exit request never settles.
    await first.shutdown();
    vi.resetModules();
    const { init: reload } = await import("./index");
    const next = reload(config);
    expect(fetchMock).toHaveBeenCalledTimes(2); // restored queues send during init
    await next.flush();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events).toEqual([event]);
    expect(queueKeys(sessionStorage)).toEqual([]);
    await next.shutdown();
  });

  it("keeps other in-flight batches persisted when one request succeeds", async () => {
    const complete: Array<(value: { ok: boolean }) => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
    const tracker = init({ ...config, batch: { maxEvents: 1 } });
    for (const name of ["first", "second", "third"]) tracker.track(name);
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    complete[1]({ ok: true });
    await Promise.resolve();
    expect(persisted(sessionStorage).map((e: any) => e.name)).toEqual(["first", "third"]);
    complete[0]({ ok: true });
    complete[2]({ ok: true });
    await tracker.flush();
    expect(queueKeys(sessionStorage)).toEqual([]);
    await tracker.shutdown();
  });

  it.each(["quota", "unavailable"])("reports the lost count when storage throws (%s)", async (failure) => {
    if (failure === "quota") {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    } else {
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    }
    const onError = vi.fn();
    const tracker = init({ ...config, onError });
    for (const name of ["one", "two", "three"]) tracker.track(name, { data: "x".repeat(60_000) });
    expect(onError).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "HEAT_E_EVENTS_DROPPED",
        details: { dropped: 3 },
        message: expect.any(String),
        fix: expect.any(String),
        docs: expect.stringContaining("#heat_e_events_dropped")
      })
    );
    await tracker.shutdown();
  });

  it("reports failed exit batches that cannot be persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const onError = vi.fn();
    const tracker = init({ ...config, onError });
    tracker.track("lost");
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual(["HEAT_E_INGEST_NETWORK", "HEAT_E_EVENTS_DROPPED"]);
    expect(onError.mock.calls[1][0].details).toEqual({ dropped: 1 });
    await tracker.shutdown();
  });

  it("reports queue-limit drops with the same error catalog", async () => {
    const onError = vi.fn();
    const tracker = init({ ...config, batch: { maxQueueBytes: 1 }, onError });
    tracker.track("trimmed");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HEAT_E_EVENTS_DROPPED", details: { dropped: 1 } })
    );
    await tracker.shutdown();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
