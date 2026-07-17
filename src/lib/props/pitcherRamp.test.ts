import { describe, expect, it } from "vitest";
import { pitcherRampFor, PITCHER_RAMPS } from "./pitcherRamp";

describe("pitcherRampFor", () => {
  it("returns a bounded ramp for a fitted pitcher (stat, line)", () => {
    const ramp = pitcherRampFor("strikeoutsPitching", 5.5);
    expect(ramp).toBeDefined();
    expect(ramp!.cap).toBe(8);
    expect(ramp!.slope).toBeGreaterThan(0); // strikeouts climb with workload
  });

  it("gives innings-driven stats a positive slope and walks a negative one", () => {
    expect(pitcherRampFor("outsRecorded", 17.5)!.slope).toBeGreaterThan(0);
    expect(pitcherRampFor("hitsAllowed", 5.5)!.slope).toBeGreaterThan(0);
    // Walks don't scale with innings — control firms up as a starter stretches out.
    expect(pitcherRampFor("walksAllowed", 2.5)!.slope).toBeLessThan(0);
  });

  it("returns undefined for batting stats and off-grid lines (→ no ramp applied)", () => {
    expect(pitcherRampFor("hits", 0.5)).toBeUndefined();
    expect(pitcherRampFor("strikeoutsBatting", 0.5)).toBeUndefined();
    expect(pitcherRampFor("strikeoutsPitching", 99.5)).toBeUndefined();
  });

  it("covers every board pitcher line with a valid cap", () => {
    for (const [key, ramp] of Object.entries(PITCHER_RAMPS)) {
      expect(key).toMatch(/^[a-zA-Z]+:\d+(\.\d+)?$/);
      expect(ramp.cap).toBeGreaterThan(0);
      expect(Number.isFinite(ramp.slope)).toBe(true);
      expect(Number.isFinite(ramp.pivot)).toBe(true);
    }
  });
});
