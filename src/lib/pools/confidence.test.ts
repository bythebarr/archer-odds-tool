import { describe, expect, it } from "vitest";
import { poolConfidence, recordOf } from "./confidence";

const verdicts = new Map([["market-blend:nba:points", "trusted"]]);
const row = { sport: "nba", statKey: "points", archr: 0.6, priceAmerican: -110, rate: [8, 10] as [number, number], fallbackGames: 40, alt: false };

describe("poolConfidence", () => {
  it("reads the stat's blend card: a trusted card lifts the grade", () => {
    const trusted = poolConfidence(row, verdicts)!;
    const unproven = poolConfidence({ ...row, statKey: "rebounds" }, verdicts)!;
    expect(trusted.score - unproven.score).toBe(15);
    expect(unproven.why).toMatch(/haven't earned a passing report card/);
  });

  it("uses the source's facts when it attached them", () => {
    const thin = poolConfidence({ ...row, facts: { market: 0.4, injury: "questionable", games: 6, recentMinutes: 20 }, projectedMinutes: 30 }, verdicts)!;
    expect(thin.grade).toBe("D");
    expect(thin.why).toMatch(/Listed questionable|Only|ARCHR is/);
  });

  it("sports the blend doesn't price start neutral on track record; no read, no grade", () => {
    expect(poolConfidence({ ...row, sport: "soccer", statKey: "shots" }, verdicts)!.why).not.toMatch(/report card/);
    expect(poolConfidence({ ...row, archr: null }, verdicts)).toBeUndefined();
  });

  it("checks the longer record when the short one is thin", () => {
    expect(recordOf([3, 4], [20, 30])).toEqual([20, 30]);
    expect(recordOf([4, 5], [20, 30])).toEqual([4, 5]);
  });
});
