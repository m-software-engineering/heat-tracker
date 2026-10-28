import { describe, expect, it } from "vitest";
import { eventRowId } from "./event-row-id";

describe("eventRowId", () => {
  it("scopes by project and distinguishes move point indexes from NUL-like eventIds", () => {
    expect(eventRowId("p1", "e")).not.toBe(eventRowId("p2", "e"));
    expect(eventRowId("p", "e", 0)).not.toBe(eventRowId("p", "e"));
    expect(eventRowId("p", "e\u00000")).not.toBe(eventRowId("p", "e", 0));
    expect(eventRowId("p", "e", 0)).toBe(eventRowId("p", "e", 0));
  });
});
