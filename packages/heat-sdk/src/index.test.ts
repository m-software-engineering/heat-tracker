import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { init } from "./index";

const storageKeys = (storage: Storage) => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  return keys;
};

const queueKeys = () => storageKeys(localStorage).filter((key) => key.includes(":queue"));

const customEvent = (eventId: string) => ({
  eventId,
  sessionId: "restored-session",
  ts: Date.now(),
  path: "/",
  viewport: { w: 1024, h: 768, dpr: 1 },
  device: { ua: "test", platform: "mac", language: "en" },
  meta: { viewportBucket: "1000x800" },
  type: "custom",
  name: eventId
});

describe("heat-sdk", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDnt = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn">Click</button>
      <input id="input" type="text" />
    `;
    localStorage.clear();
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
    Object.defineProperty(Navigator.prototype, "doNotTrack", {
      value: "0",
      configurable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDnt) {
      Object.defineProperty(Navigator.prototype, "doNotTrack", originalDnt);
    }
  });

  it("sends click events on flush", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: { pageview: false }
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const clickEvent = body.events.find((event: any) => event.type === "click");
    expect(clickEvent).toBeDefined();
  });

  it("captures click coordinates with scroll offset", async () => {
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
    Object.defineProperty(window, "scrollX", { value: 25, configurable: true });

    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: { pageview: false }
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.flush();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const clickEvent = body.events.find((event: any) => event.type === "click");
    expect(clickEvent.x).toBe(35);
    expect(clickEvent.y).toBe(320);
  });

  it("masks input values when enabled", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: {
        pageview: false,
        inputs: { enabled: true, mode: "masked" }
      }
    });

    const input = document.getElementById("input") as HTMLInputElement;
    input.value = "secret-value";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await tracker.flush();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const inputEvent = body.events.find((event: any) => event.type === "input");
    expect(inputEvent).toBeDefined();
    expect(inputEvent.masked).toBeTruthy();
    expect(inputEvent.masked).not.toBe(input.value);
  });

  it("respects doNotTrack", async () => {
    Object.defineProperty(Navigator.prototype, "doNotTrack", {
      value: "1",
      configurable: true
    });

    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key"
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    await tracker.shutdown();
  });

  it("flushes queued events during shutdown", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key"
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const clickEvent = body.events.find((event: any) => event.type === "click");
    expect(clickEvent).toBeDefined();
  });

  it("restores history methods on shutdown", async () => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key"
    });

    expect(history.pushState).not.toBe(originalPushState);
    expect(history.replaceState).not.toBe(originalReplaceState);

    await tracker.shutdown();

    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });

  it("clears persisted queue after successful flush", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      batch: {
        storage: "localStorage",
        maxEvents: 50,
        flushIntervalMs: 60_000,
        maxQueueBytes: 1_000_000
      }
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    expect(queueKeys()).toHaveLength(1);

    await tracker.flush();

    expect(queueKeys()).toHaveLength(0);
    await tracker.shutdown();
  });

  it("does not replay one project queue through another tracker", async () => {
    const trackerA = init({
      endpoint: "http://localhost:4000/ingest-a",
      projectKey: "project-a",
      capture: { pageview: false },
      batch: { storage: "localStorage", flushIntervalMs: 60_000 }
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));
    expect(queueKeys()).toHaveLength(1);

    fetchMock.mockClear();
    const trackerB = init({
      endpoint: "http://localhost:4000/ingest-b",
      projectKey: "project-b",
      capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false },
      batch: { storage: "localStorage", flushIntervalMs: 60_000 }
    });

    await trackerB.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    await trackerA.shutdown();
    await trackerB.shutdown();
  });

  it("captures no input or keyboard events in allowlist mode without allow selectors", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: {
        click: false,
        move: { enabled: false, throttleMs: 80 },
        scroll: false,
        pageview: false,
        inputs: { enabled: true, mode: "allowlist" },
        keyboard: { enabled: true, mode: "allowlist" }
      },
      batch: { flushIntervalMs: 60_000 }
    });

    const input = document.getElementById("input") as HTMLInputElement;
    input.value = "allowed-only-when-selector-matches";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));

    await tracker.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    await tracker.shutdown();
  });

  it("does not capture movement over blocked private elements", async () => {
    document.body.innerHTML += `<div id="private" data-private>Private</div>`;
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: {
        click: false,
        move: { enabled: true, throttleMs: 0 },
        scroll: false,
        pageview: false
      },
      batch: { flushIntervalMs: 60_000 }
    });

    const privateEl = document.getElementById("private") as HTMLDivElement;
    privateEl.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    await tracker.shutdown();
  });

  it("starts when session storage is unavailable", async () => {
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    let tracker: ReturnType<typeof init> | undefined;

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("session storage blocked");
      }
    });

    try {
      expect(() => {
        tracker = init({
          endpoint: "http://localhost:4000/ingest",
          projectKey: "test-key",
          capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false },
          batch: { flushIntervalMs: 60_000 }
        });
      }).not.toThrow();
      await tracker?.shutdown();
    } finally {
      if (sessionStorageDescriptor) {
        Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
      }
    }
  });

  it("flushes restored queues across multiple batches", async () => {
    const seedTracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false },
      batch: { storage: "localStorage", maxEvents: 10, flushIntervalMs: 60_000 }
    });
    seedTracker.track("seed");
    const [queueKey] = queueKeys();
    expect(queueKey).toBeTruthy();

    localStorage.setItem(
      queueKey,
      JSON.stringify([
        customEvent("event-1"),
        customEvent("event-2"),
        customEvent("event-3"),
        customEvent("event-4"),
        customEvent("event-5")
      ])
    );
    fetchMock.mockClear();

    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false },
      batch: { storage: "localStorage", maxEvents: 2, flushIntervalMs: 60_000 }
    });

    await tracker.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sentEvents = fetchMock.mock.calls.flatMap((call) => JSON.parse(call[1].body).events);
    expect(sentEvents.map((event: any) => event.eventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5"
    ]);

    await seedTracker.shutdown();
    await tracker.shutdown();
  });

  it("normalizes invalid maxEvents so flush makes progress", async () => {
    for (const maxEvents of [0, Number.NaN]) {
      const sentBatches: any[][] = [];
      let tracker: ReturnType<typeof init> | undefined;

      fetchMock.mockReset();
      fetchMock.mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        sentBatches.push(body.events);
        return { ok: body.events.length > 0 };
      });

      try {
        tracker = init({
          endpoint: "http://localhost:4000/ingest",
          projectKey: `invalid-max-events-${String(maxEvents)}`,
          capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: false },
          batch: { maxEvents, flushIntervalMs: 60_000 }
        });

        tracker.track("invalid-max-events");
        await tracker.flush();

        expect(sentBatches).toHaveLength(1);
        expect(sentBatches[0]).toHaveLength(1);
        expect(sentBatches[0][0].name).toBe("invalid-max-events");
      } finally {
        await tracker?.shutdown();
      }
    }
  });

  it("keeps history patched until all pageview trackers shut down", async () => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    let trackerA: ReturnType<typeof init> | undefined;
    let trackerB: ReturnType<typeof init> | undefined;

    try {
      trackerA = init({
        endpoint: "http://localhost:4000/ingest-a",
        projectKey: "project-a",
        capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: true },
        batch: { flushIntervalMs: 60_000 }
      });
      trackerB = init({
        endpoint: "http://localhost:4000/ingest-b",
        projectKey: "project-b",
        capture: { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false, pageview: true },
        batch: { flushIntervalMs: 60_000 }
      });

      await trackerA.shutdown();
      expect(history.pushState).not.toBe(originalPushState);
      expect(history.replaceState).not.toBe(originalReplaceState);

      await trackerB.shutdown();
      expect(history.pushState).toBe(originalPushState);
      expect(history.replaceState).toBe(originalReplaceState);
    } finally {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    }
  });
});
