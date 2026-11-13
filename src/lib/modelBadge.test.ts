import { describe, it, expect } from "vitest";
import { isUnprovenVerdict, trackRecordLabel } from "./modelBadge";

/** Passing is opt-in: only a `trusted` verdict clears a model; a missing status never does. */
describe("isUnprovenVerdict", () => {
  it("treats only a trusted verdict as passing", () => {
    expect(isUnprovenVerdict("trusted")).toBe(false);
    for (const v of ["marginal", "unproven", "thin", null, undefined]) expect(isUnprovenVerdict(v)).toBe(true);
  });
});

describe("trackRecordLabel", () => {
  it("shows nothing for a trusted model", () => {
    expect(trackRecordLabel("trusted", 900)).toBeNull();
  });
  it("states the report card's standing and graded count", () => {
    expect(trackRecordLabel("thin", 38)).toBe("Early record · 38 graded");
    expect(trackRecordLabel("marginal", 1412)).toBe("Even with baseline · 1,412 graded");
    expect(trackRecordLabel("unproven", 412)).toBe("Not ahead of baseline · 412 graded");
  });
  it("leaves the count off when it isn't known, and says when there's no card", () => {
    expect(trackRecordLabel("marginal")).toBe("Even with baseline");
    expect(trackRecordLabel(null)).toBe("Not graded yet");
    expect(trackRecordLabel(undefined, 50)).toBe("Not graded yet");
  });
  it("never says unproven", () => {
    for (const v of ["marginal", "unproven", "thin", null]) expect(trackRecordLabel(v, 10)!.toLowerCase()).not.toContain("unproven");
  });
});
