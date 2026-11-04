import { describe, it, expect } from "vitest";
import { UNPROVEN_MODEL_BADGE, isUnprovenVerdict, unprovenBadgeLabel } from "./modelBadge";

/**
 * The badge predicate (Prompt 5). Proven is opt-in: only a `trusted`
 * calibration verdict clears a model; every other grade — and a model with
 * no status at all — is unproven and gets the badge.
 */
describe("isUnprovenVerdict", () => {
  it("treats only a trusted verdict as proven", () => {
    expect(isUnprovenVerdict("trusted")).toBe(false);
  });
  it("treats every non-passing grade as unproven", () => {
    expect(isUnprovenVerdict("marginal")).toBe(true);
    expect(isUnprovenVerdict("unproven")).toBe(true);
    expect(isUnprovenVerdict("thin")).toBe(true);
  });
  it("treats a missing status as unproven", () => {
    expect(isUnprovenVerdict(null)).toBe(true);
    expect(isUnprovenVerdict(undefined)).toBe(true);
  });
});

describe("unprovenBadgeLabel", () => {
  it("badges an unproven model", () => {
    expect(unprovenBadgeLabel("marginal")).toBe(UNPROVEN_MODEL_BADGE);
    expect(unprovenBadgeLabel("unproven")).toBe(UNPROVEN_MODEL_BADGE);
    expect(unprovenBadgeLabel("thin")).toBe(UNPROVEN_MODEL_BADGE);
  });
  it("badges a model with no status", () => {
    expect(unprovenBadgeLabel(null)).toBe(UNPROVEN_MODEL_BADGE);
    expect(unprovenBadgeLabel(undefined)).toBe(UNPROVEN_MODEL_BADGE);
  });
  it("badges nothing for a proven model", () => {
    expect(unprovenBadgeLabel("trusted")).toBeNull();
  });
  it("uses the approved badge copy", () => {
    expect(UNPROVEN_MODEL_BADGE).toBe("Unproven model — small sample");
  });
});
