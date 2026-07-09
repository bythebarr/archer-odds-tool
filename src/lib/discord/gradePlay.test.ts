import { describe, it, expect } from "vitest";
import { gradeGameLine, gradeProp, unitsProfit, tallyLedger } from "./gradePlay";

describe("gradeGameLine", () => {
  it("moneyline: backs the winner, no push", () => {
    expect(gradeGameLine("h2h", "home", null, 5, 3)).toBe("hit");
    expect(gradeGameLine("h2h", "away", null, 5, 3)).toBe("miss");
    expect(gradeGameLine("h2h", "away", null, 2, 7)).toBe("hit");
    expect(gradeGameLine("h2h", "draw", null, 1, 1)).toBe("void"); // no MLB draw
  });

  it("spread: grades at the play's own point, push on exact", () => {
    // home -1.5, wins by 2 → covers
    expect(gradeGameLine("spreads", "home", -1.5, 5, 3)).toBe("hit");
    // home -1.5, wins by 1 → margin -0.5 → miss
    expect(gradeGameLine("spreads", "home", -1.5, 4, 3)).toBe("miss");
    // away +1.5, loses by 1 → margin +0.5 → hit
    expect(gradeGameLine("spreads", "away", 1.5, 4, 3)).toBe("hit");
    // home -2, wins by exactly 2 → push
    expect(gradeGameLine("spreads", "home", -2, 5, 3)).toBe("push");
    expect(gradeGameLine("spreads", "home", null, 5, 3)).toBe("void");
  });

  it("total: over/under with push on exact", () => {
    expect(gradeGameLine("totals", "over", 8.5, 5, 4)).toBe("hit"); // 9 > 8.5
    expect(gradeGameLine("totals", "under", 8.5, 5, 4)).toBe("miss");
    expect(gradeGameLine("totals", "over", 9, 5, 4)).toBe("push"); // exactly 9
    expect(gradeGameLine("totals", "under", 9, 5, 4)).toBe("push");
    expect(gradeGameLine("totals", "over", 10, 5, 4)).toBe("miss"); // 9 < 10
  });
});

describe("gradeProp", () => {
  it("over/under a stat, push on exact whole-number line", () => {
    expect(gradeProp("over", 1.5, 2)).toBe("hit");
    expect(gradeProp("over", 1.5, 1)).toBe("miss");
    expect(gradeProp("under", 1.5, 1)).toBe("hit");
    expect(gradeProp("over", 2, 2)).toBe("push"); // landed exactly on a whole line
    expect(gradeProp("under", 2, 2)).toBe("push");
  });

  it("voids a missing stat line (DNP is not a loss)", () => {
    expect(gradeProp("over", 1.5, null)).toBe("void");
    expect(gradeProp("under", 0.5, null)).toBe("void");
  });
});

describe("unitsProfit", () => {
  it("wins pay decimal-1 × stake; losses cost the stake; push/void are flat", () => {
    // +100 = decimal 2.0 → 1u win pays 1u
    expect(unitsProfit("hit", 1, 100)).toBeCloseTo(1, 6);
    // -110 = decimal ~1.909 → 1u win pays ~0.909u
    expect(unitsProfit("hit", 1, -110)).toBeCloseTo(0.9091, 3);
    // +150, 2u stake → pays 3u
    expect(unitsProfit("hit", 2, 150)).toBeCloseTo(3, 6);
    expect(unitsProfit("miss", 1.5, -110)).toBe(-1.5);
    expect(unitsProfit("push", 2, 120)).toBe(0);
    expect(unitsProfit("void", 2, 120)).toBe(0);
  });
});

describe("tallyLedger", () => {
  it("builds a W-L-P record + net units, excluding voids", () => {
    const l = tallyLedger([
      { result: "hit", units: 1, bestPrice: 100 }, // +1.0
      { result: "miss", units: 1, bestPrice: -110 }, // -1.0
      { result: "push", units: 1, bestPrice: 100 }, // 0, counts as P
      { result: "void", units: 5, bestPrice: 100 }, // excluded entirely
      { result: "hit", units: 2, bestPrice: 150 }, // +3.0
    ]);
    expect(l.hits).toBe(2);
    expect(l.misses).toBe(1);
    expect(l.pushes).toBe(1);
    expect(l.voids).toBe(1);
    expect(l.record).toBe("2-1-1");
    expect(l.netUnits).toBeCloseTo(1 - 1 + 0 + 3, 6); // +3.0u
  });

  it("omits the push tally from the record when there are none", () => {
    const l = tallyLedger([
      { result: "hit", units: 1, bestPrice: 100 },
      { result: "miss", units: 1, bestPrice: 100 },
    ]);
    expect(l.record).toBe("1-1");
  });
});
