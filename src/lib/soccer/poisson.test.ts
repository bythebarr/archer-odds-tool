import { describe, expect, it } from "vitest";
import { DEFAULT_SOCCER_POISSON, SoccerPoisson } from "./poisson";

const withBoost = (drawBoost: number) => new SoccerPoisson({ ...DEFAULT_SOCCER_POISSON, drawBoost });

/** A model whose two teams have been fed a long run of 4-3 home wins — expected goals are high, so the score matrix's mass sits on high diagonals (2-2, 3-3, 4-4). */
function highScoringModel(drawBoost: number): SoccerPoisson {
  const m = withBoost(drawBoost);
  for (let i = 0; i < 40; i++) m.update("H", "A", 4, 3);
  return m;
}

describe("SoccerPoisson draw boost (Decision 12: scoped to 0-0 / 1-1)", () => {
  it("still inflates draws in a low-scoring matchup, where the correction applies", () => {
    const boosted = withBoost(0.5).outcomeProbs("H", "A");
    const raw = withBoost(0).outcomeProbs("H", "A");
    expect(boosted.draw).toBeGreaterThan(raw.draw);
    expect(boosted.home + boosted.draw + boosted.away).toBeCloseTo(1, 10);
  });

  it("barely moves draws in a high-scoring matchup — 2-2/3-3 cells get no boost", () => {
    const lowLift = withBoost(0.5).outcomeProbs("H", "A").draw - withBoost(0).outcomeProbs("H", "A").draw;
    const highLift = highScoringModel(0.5).outcomeProbs("H", "A").draw - highScoringModel(0).outcomeProbs("H", "A").draw;
    // Before the fix the boost hit every diagonal, so the high-scoring
    // matchup — whose draw mass lives on 2-2/3-3 — got the LARGEST lift.
    // Scoped to 0-0/1-1, its lift collapses to a fraction of the low one.
    expect(highLift).toBeGreaterThan(0);
    expect(highLift).toBeLessThan(lowLift * 0.5);
  });
});
