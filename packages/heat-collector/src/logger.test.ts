import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes warnings and errors with normalized context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("debug");

    logger.warn("slow request", { duration: 10n });
    logger.error("request failed", { cause: new Error("boom") });

    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({
      level: "warn",
      msg: "slow request",
      duration: "10"
    });
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      level: "error",
      msg: "request failed",
      cause: { name: "Error", message: "boom" }
    });
  });
});
