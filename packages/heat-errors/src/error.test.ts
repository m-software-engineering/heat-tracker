import { describe, expect, it } from "vitest";
import {
  HeatTrackerError,
  INGEST_ERRORS,
  SDK_ERRORS,
  formatHeatError,
  isHeatError,
  maskProjectKey,
  truncateIp
} from "./index";

describe("HeatTrackerError", () => {
  it("serializes to the wire shape without the original error", () => {
    const original = new Error("secret stack");
    const err = new HeatTrackerError(INGEST_ERRORS.HEAT_E_JWT_EXPIRED, "exp 10 < now 20", {
      requestId: "rid",
      details: { exp: 10 },
      original
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.original).toBe(original);
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      code: "HEAT_E_JWT_EXPIRED",
      message: "The JWT has expired.",
      cause: "exp 10 < now 20",
      fix: INGEST_ERRORS.HEAT_E_JWT_EXPIRED.fix,
      docs: expect.stringContaining("#heat_e_jwt_expired"),
      status: 401,
      requestId: "rid",
      details: { exp: 10 }
    });
    expect(isHeatError(err)).toBe(true);
  });

  it("formats one line with code, cause, fix and docs", () => {
    const err = new HeatTrackerError(SDK_ERRORS.HEAT_E_CONFIG_MISSING, "projectKey is missing");
    expect(formatHeatError(err)).toMatch(
      /^HEAT_E_CONFIG_MISSING: .+ Cause: projectKey is missing Fix: Pass .+ Docs: https:\/\/.+#heat_e_config_missing$/
    );
  });

  it("rejects non-errors", () => {
    expect(isHeatError(null)).toBe(false);
    expect(isHeatError({ code: "invalid_jwt" })).toBe(false);
  });
});

describe("redaction", () => {
  it("masks project keys to prefix and last 4", () => {
    expect(maskProjectKey("pk_live_0123456789a1b2")).toBe("pk_…a1b2");
    expect(maskProjectKey("dev-project-key-abcd")).toBe("…abcd");
    expect(maskProjectKey("short")).toBe("…");
  });

  it("truncates IPs", () => {
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0");
    expect(truncateIp("::ffff:127.0.0.1")).toBe("127.0.0.0");
    expect(truncateIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3::");
    expect(truncateIp("garbage")).toBe("unknown");
  });
});
