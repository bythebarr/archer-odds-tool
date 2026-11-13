import { describe, it, expect } from "vitest";
import { isUnprovenVerdict, trackRecordLabel, verdictLabel } from "./modelBadge";

/** Passing is opt-in: only a `trusted` verdict clears a model; a missing status never does. */
describe("isUnprovenVerdict", () => {
  it("treats only a trusted verdict as passing", () => {
    expect(isUnprovenVerdict("trusted")).toBe(false);
    for (const v of ["marginal", "unproven", "thin", null, undefined]) expect(isUnprovenVerdict(v)).toBe(true);
  });
});

describe("one verdict vocabulary", () => {
  it("maps every report-card verdict to Trusted / Marginal / Thin / Not graded yet", () => {
    expect(verdictLabel("trusted")).toBe("Trusted");
    expect(verdictLabel("marginal")).toBe("Marginal");
    expect(verdictLabel("unproven")).toBe("Marginal");
    expect(verdictLabel("thin")).toBe("Thin");
    expect(verdictLabel(null)).toBe("Not graded yet");
  });
  it("track-record chip: nothing for trusted, the label and graded count otherwise", () => {
    expect(trackRecordLabel("trusted", 900)).toBeNull();
    expect(trackRecordLabel("thin", 38)).toBe("Thin · 38 graded");
    expect(trackRecordLabel("marginal", 1412)).toBe("Marginal · 1,412 graded");
    expect(trackRecordLabel("unproven")).toBe("Marginal");
    expect(trackRecordLabel(undefined, 50)).toBe("Not graded yet");
  });
});
