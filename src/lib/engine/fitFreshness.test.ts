import { describe, expect, it } from "vitest";
import { FIT_MAX_AGE_DAYS, fitAgeDays, isFitFresh } from "./fitFreshness";

const now = new Date("2026-11-09T15:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("fit staleness gate", () => {
  it("accepts a fit from this week's lab run", () => {
    expect(isFitFresh(daysAgo(3), now)).toBe(true);
    expect(isFitFresh(now, now)).toBe(true);
  });

  it("accepts a fit exactly at the cap and rejects one past it", () => {
    expect(isFitFresh(daysAgo(FIT_MAX_AGE_DAYS), now)).toBe(true);
    expect(isFitFresh(daysAgo(FIT_MAX_AGE_DAYS + 1), now)).toBe(false);
  });

  it("rejects the frozen-October case: a fit from last season", () => {
    expect(isFitFresh(new Date("2026-07-16T00:00:00Z"), now)).toBe(false);
  });

  it("rejects future-dated fits rather than pricing on them forever", () => {
    expect(isFitFresh(daysAgo(-2), now)).toBe(false);
  });

  it("measures whole days", () => {
    expect(fitAgeDays(daysAgo(10), now)).toBe(10);
  });
});
