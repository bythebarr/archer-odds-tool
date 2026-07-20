import { describe, it, expect } from "vitest";
import {
  impliedProb,
  evAtPrice,
  evaluate,
  matchPlays,
  renderVerdict,
  GOOD_EV,
} from "./valueCheck";
import { calculateEv } from "@/lib/odds/devig";
import type { Play } from "@/lib/engine";

/**
 * The re-price is the load-bearing part: a wrong probability recovery would
 * confidently tell a member a bad number is good. These pin the round-trip and
 * the verdict boundaries, plus the two refusals to guess (ambiguous / no match).
 */

function play(over: Partial<Play> = {}): Play {
  return {
    sportKey: "mlb",
    playKey: "k1",
    eventRef: "g1",
    postedForDate: "2026-07-20",
    startUtc: new Date("2026-07-20T23:05:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Yankees ML" },
    bestPrice: -120,
    bestBookName: "FanDuel",
    marketEv: 0.03,
    modelEv: 0.06,
    suggestedUnits: 1,
    ...over,
  };
}

describe("probability recovery", () => {
  it("round-trips: EV → probability → the same EV at the same price", () => {
    const p = impliedProb(0.06, -120);
    expect(calculateEv(p, -120)).toBeCloseTo(0.06, 10);
  });

  it("recovers a sane probability (a -120 favorite with +6% edge is ~58%)", () => {
    expect(impliedProb(0.06, -120)).toBeCloseTo(0.5782, 3);
  });

  it("a worse price yields less EV, a better price more", () => {
    expect(evAtPrice(0.06, -120, -150)).toBeLessThan(0.06);
    expect(evAtPrice(0.06, -120, +100)).toBeGreaterThan(0.06);
  });

  it("is unchanged when their price equals ours", () => {
    expect(evAtPrice(0.06, -120, -120)).toBeCloseTo(0.06, 10);
  });
});

describe("evaluate", () => {
  it("calls a clearly good number good, on both lenses", () => {
    const r = evaluate(play(), +110);
    expect(r.verdict).toBe("good");
    expect(r.modelEv!).toBeGreaterThan(GOOD_EV);
    expect(r.marketEv!).toBeGreaterThan(GOOD_EV);
  });

  it("calls a badly juiced number poor", () => {
    const r = evaluate(play(), -250);
    expect(r.verdict).toBe("poor");
  });

  it("reports MIXED when the lenses genuinely disagree rather than picking one", () => {
    // Model loves it, market hates it, at the same quoted price.
    const r = evaluate(play({ modelEv: 0.15, marketEv: -0.08 }), -120);
    expect(r.verdict).toBe("mixed");
    expect(r.modelEv!).toBeGreaterThan(0);
    expect(r.marketEv!).toBeLessThan(0);
  });

  it("judges on the one lens available when a play has no model EV", () => {
    const r = evaluate(play({ modelEv: null }), +200);
    expect(r.modelEv).toBeNull();
    expect(r.marketEv).not.toBeNull();
    expect(r.verdict).toBe("good");
  });

  it("has no read when neither lens covers the play", () => {
    const r = evaluate(play({ modelEv: null, marketEv: null }), -110);
    expect(r.verdict).toBe("unknown");
    expect(renderVerdict(r)).toContain("don't have a priced read");
  });

  it("surfaces a better number when our board beats theirs", () => {
    const r = evaluate(play({ bestPrice: -110, bestBookName: "DraftKings" }), -130);
    expect(r.betterPrice).toEqual({ price: -110, book: "DraftKings" });
    expect(renderVerdict(r)).toContain("DraftKings");
  });

  it("says nothing when the member already beat our number", () => {
    const r = evaluate(play({ bestPrice: -130 }), -110);
    expect(r.betterPrice).toBeNull();
  });

  it("says nothing when the prices are identical", () => {
    const r = evaluate(play({ bestPrice: -120 }), -120);
    expect(r.betterPrice).toBeNull();
  });
});

describe("matchPlays", () => {
  const yanks = play({ playKey: "a", selection: { market: null, kind: "ml", side: "home", point: null, label: "Yankees ML" } });
  const yanksRl = play({ playKey: "b", selection: { market: null, kind: "spread", side: "home", point: -1.5, label: "Yankees -1.5" } });
  const over = play({ playKey: "c", selection: { market: null, kind: "total", side: "over", point: 8.5, label: "Over 8.5" } });

  it("matches loosely, the way members actually type", () => {
    expect(matchPlays("yankees", [yanks, yanksRl, over])).toHaveLength(2);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(matchPlays("  YANKEES ml ", [yanks, yanksRl, over])).toEqual([yanks]);
  });

  it("prefers an exact label over its own substring matches", () => {
    expect(matchPlays("Yankees ML", [yanks, yanksRl])).toEqual([yanks]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    // The dangerous failure: an empty string substring-matches every play.
    expect(matchPlays("   ", [yanks, yanksRl, over])).toEqual([]);
  });

  it("returns nothing when there's no match", () => {
    expect(matchPlays("dodgers", [yanks, over])).toEqual([]);
  });
});
