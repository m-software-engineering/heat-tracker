import { describe, it, expect, vi } from "vitest";
import { FRAME_HELLO_TYPE, announceToParentFrame } from "./frame-handshake";

const framedWindow = (postMessage: (...args: unknown[]) => void) =>
  ({ parent: { postMessage }, location: { href: "https://shop.test/pricing?x=1" } }) as unknown as Window;

describe("announceToParentFrame", () => {
  it("posts the page's location.href to the parent when framed", () => {
    const postMessage = vi.fn();
    announceToParentFrame(framedWindow(postMessage));
    expect(postMessage).toHaveBeenCalledWith({ type: FRAME_HELLO_TYPE, href: "https://shop.test/pricing?x=1" }, "*");
  });

  it("does nothing in a top-level window", () => {
    const spy = vi.spyOn(window, "postMessage");
    announceToParentFrame(window);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never throws when the parent cannot be reached", () => {
    expect(() =>
      announceToParentFrame(
        framedWindow(() => {
          throw new Error("detached");
        })
      )
    ).not.toThrow();
  });
});
