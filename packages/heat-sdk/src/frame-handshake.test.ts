import { describe, it, expect, vi } from "vitest";
import { FRAME_HELLO_TYPE, announceToParentFrame } from "./frame-handshake";

const framedWindow = (postMessage: (...args: unknown[]) => void) =>
  ({
    parent: { postMessage },
    location: { href: "https://shop.test/pricing?token=secret#frag", origin: "https://shop.test", pathname: "/pricing" }
  }) as unknown as Window;

describe("announceToParentFrame", () => {
  it("sends only origin + pathname: no query or hash", () => {
    const postMessage = vi.fn();
    announceToParentFrame(["https://dash.test"], framedWindow(postMessage));
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message).toEqual({ type: FRAME_HELLO_TYPE, href: "https://shop.test/pricing" });
    expect(JSON.stringify(message)).not.toMatch(/token|secret|frag|\?|#/);
  });

  it("posts once per dashboard origin, with that exact origin as targetOrigin (never *)", () => {
    const postMessage = vi.fn();
    announceToParentFrame(
      ["https://dash.test/some/path", "http://localhost:3000", "not a url"],
      framedWindow(postMessage)
    );
    expect(postMessage.mock.calls.map(([, target]) => target)).toEqual(["https://dash.test", "http://localhost:3000"]);
    expect(postMessage.mock.calls.map(([, target]) => target)).not.toContain("*");
  });

  it("sends nothing without dashboardOrigins", () => {
    const postMessage = vi.fn();
    announceToParentFrame(undefined, framedWindow(postMessage));
    announceToParentFrame([], framedWindow(postMessage));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does nothing in a top-level window", () => {
    const spy = vi.spyOn(window, "postMessage");
    announceToParentFrame(["https://dash.test"], window);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never throws when the parent cannot be reached", () => {
    const fail = framedWindow(() => {
      throw new Error("detached");
    });
    expect(() => announceToParentFrame(["https://dash.test"], fail)).not.toThrow();
  });
});
