import { describe, expect, it } from "vitest";
import { baseIntervalMinutes, budgetStretch, isDue } from "./cadence";

const now = new Date("2026-10-15T12:00:00Z");
const minsFromNow = (m: number) => new Date(now.getTime() + m * 60_000);

describe("baseIntervalMinutes", () => {
  it("polls faster as the next game nears", () => {
    expect(baseIntervalMinutes(60, false)).toBe(10);
    expect(baseIntervalMinutes(600, false)).toBe(30);
    expect(baseIntervalMinutes(48 * 60, false)).toBe(180);
    expect(baseIntervalMinutes(7 * 24 * 60, false)).toBe(720);
  });
  it("skips leagues with nothing scheduled, and polls futures daily", () => {
    expect(baseIntervalMinutes(null, false)).toBeNull();
    expect(baseIntervalMinutes(null, true)).toBe(1440);
  });
});

describe("isDue", () => {
  it("is due when never polled or the interval has passed", () => {
    expect(isDue({ nextEventAt: minsFromNow(60), lastPolledAt: null, outright: false }, now)).toBe(true);
    expect(isDue({ nextEventAt: minsFromNow(60), lastPolledAt: minsFromNow(-12), outright: false }, now)).toBe(true);
    expect(isDue({ nextEventAt: minsFromNow(60), lastPolledAt: minsFromNow(-5), outright: false }, now)).toBe(false);
  });
  it("stretches intervals under the governor", () => {
    const l = { nextEventAt: minsFromNow(60), lastPolledAt: minsFromNow(-12), outright: false };
    expect(isDue(l, now, 2)).toBe(false);
  });
});

describe("budgetStretch", () => {
  it("is 1 on plan and grows when spend runs ahead", () => {
    // Halfway through October: 14.5 of 31 days elapsed → plan ≈ 46.8% of budget.
    expect(budgetStretch(400_000, 1_000_000, now)).toBe(1);
    expect(budgetStretch(568_000, 1_000_000, now)).toBeGreaterThan(3);
    expect(budgetStretch(10_000_000, 1_000_000, now)).toBe(8);
  });
});
