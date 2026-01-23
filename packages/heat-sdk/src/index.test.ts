import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { init } from "./index";

describe("heat-sdk", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDnt = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn">Click</button>
      <input id="input" type="text" />
    `;
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
      projectKey: "test-key"
    });

    const btn = document.getElementById("btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

    await tracker.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const clickEvent = body.events.find((event: any) => event.type === "click");
    expect(clickEvent).toBeDefined();
  });

  it("masks input values when enabled", async () => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      capture: {
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
});
