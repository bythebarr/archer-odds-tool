import { describe, it, expect } from "vitest";
import { pickFromBout, deriveFinishLean } from "./ufcBestPlays";
import type { FinishProjection } from "@/lib/ufc/finishMath";

/** Minimal FinishProjection fixture — only the fields deriveFinishLean reads matter. */
function finishFixture(over: Partial<FinishProjection> = {}): FinishProjection {
  return {
    available: true,
    method: { ko: 0.4, submission: 0.1, decision: 0.5 },
    byFighter: { a: { ko: 0.4, submission: 0.1, decision: 0.1 }, b: { ko: 0, submission: 0, decision: 0.4 } },
    finishProb: 0.5,
    goesTheDistanceProb: 0.5,
    rounds: [0.25, 0.15, 0.1, 0, 0],
    perFighterRounds: { a: [0.3, 0.08, 0.02, 0, 0], b: [0, 0, 0, 0, 0] },
    scheduledRounds: 5,
    expectedFinishRound: 1.5,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fighterA: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fighterB: {} as any,
    ...over,
  };
}

const bout = {
  id: "b1",
  weightClass: "Lightweight",
  titleBout: false,
  redId: "red-id",
  redName: "Red Fighter",
  blueId: "blue-id",
  blueName: "Blue Fighter",
};

describe("pickFromBout (Archer EV selection)", () => {
  it("backs the higher-EV (value) side and reports its price/EV", () => {
    // red 52.5% @ +100 → EV +5%; blue 47.5% @ -110 → EV ~-9.3%. Red is the value side.
    const play = pickFromBout(bout, 0.525, 0.475, { priceAmerican: 100, bookKey: "draftkings" }, { priceAmerican: -110, bookKey: "fanduel" });
    expect(play).not.toBeNull();
    expect(play!.side).toBe("red");
    expect(play!.pickName).toBe("Red Fighter");
    expect(play!.pickFighterId).toBe("red-id");
    expect(play!.opponentName).toBe("Blue Fighter");
    expect(play!.bestPrice).toBe(100);
    expect(play!.bestBookName).toBe("draftkings");
    expect(play!.archerEv).toBeCloseTo(0.05, 3);
  });

  it("backs the underdog when the model rates it above the market", () => {
    // blue 52% @ +110 → EV ~+9.2% (the value); red 48% @ -140 → EV negative.
    const play = pickFromBout(bout, 0.48, 0.52, { priceAmerican: -140, bookKey: "betmgm" }, { priceAmerican: 110, bookKey: "draftkings" });
    expect(play!.side).toBe("blue");
    expect(play!.pickName).toBe("Blue Fighter");
    expect(play!.bestPrice).toBe(110);
    expect(play!.archerEv).toBeCloseTo(0.092, 2);
  });

  it("posts any positive edge — no floor (a thin +1% still plays)", () => {
    // red 50.5% @ +100 → EV +1%. No floor now: it's an edge, it posts.
    const play = pickFromBout(bout, 0.505, 0.495, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" });
    expect(play!.side).toBe("red");
    expect(play!.archerEv).toBeCloseTo(0.01, 3);
  });

  it("posts big edges too — no ceiling (the record is the judge)", () => {
    // red 70% @ +100 → EV +40%. No ceiling now: it posts.
    const play = pickFromBout(bout, 0.7, 0.3, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" });
    expect(play!.side).toBe("red");
    expect(play!.archerEv).toBeCloseTo(0.4, 3);
  });

  it("still drops a non-positive edge (nothing to post)", () => {
    // red 45% @ -110 / blue 55% @ -140: best side's EV is <= 0.
    expect(pickFromBout(bout, 0.45, 0.55, { priceAmerican: -110, bookKey: "dk" }, { priceAmerican: -140, bookKey: "fd" })).toBeNull();
  });

  it("prices the only side that has a line", () => {
    const play = pickFromBout(bout, 0.525, 0.475, { priceAmerican: 100, bookKey: "dk" }, null);
    expect(play!.side).toBe("red");
    const play2 = pickFromBout(bout, 0.475, 0.525, null, { priceAmerican: 100, bookKey: "fd" });
    expect(play2!.side).toBe("blue");
  });

  it("returns null when neither corner has a line (can't price it)", () => {
    expect(pickFromBout(bout, 0.6, 0.4, null, null)).toBeNull();
  });

  it("returns null when the model couldn't price the bout (thin history)", () => {
    expect(pickFromBout(bout, null, null, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" })).toBeNull();
  });
});

describe("deriveFinishLean", () => {
  it("reads a KO/TKO lean with the pick's most likely finish round", () => {
    // Fighter A (red): ko 0.4 dominates his win mass; per-round curve peaks R1.
    const lean = deriveFinishLean(finishFixture(), "red");
    expect(lean).not.toBeNull();
    expect(lean!.method).toBe("ko");
    expect(lean!.round).toBe(1);
    expect(lean!.finishProb).toBeCloseTo(0.5, 6);
  });

  it("reads a decision lean (no round) when the pick mostly wins on points", () => {
    // Fighter B (blue): only decision mass.
    const lean = deriveFinishLean(finishFixture(), "blue");
    expect(lean!.method).toBe("decision");
    expect(lean!.round).toBeNull();
    expect(lean!.distanceProb).toBeCloseTo(0.5, 6);
  });

  it("returns null when the projection isn't available or the side has no win mass", () => {
    expect(deriveFinishLean(finishFixture({ available: false }), "red")).toBeNull();
    const noMass = finishFixture({ byFighter: { a: { ko: 0, submission: 0, decision: 0 }, b: { ko: 0.5, submission: 0, decision: 0.5 } } });
    expect(deriveFinishLean(noMass, "red")).toBeNull();
  });

  it("picks the finish round from the pick's own per-round curve, not R1 by default", () => {
    const lateFinisher = finishFixture({ perFighterRounds: { a: [0.05, 0.05, 0.3, 0, 0], b: [0, 0, 0, 0, 0] } });
    expect(deriveFinishLean(lateFinisher, "red")!.round).toBe(3);
  });
});
