import { describe, it, expect } from "vitest";
import { classifyMethod, computeFinishProjection } from "./finishMath";
import type { UfcMatchup, UfcFighterHistory, UfcFightRecord } from "@/lib/queries/ufcMatchup";

const NOW = new Date("2026-07-01T00:00:00Z");

describe("classifyMethod", () => {
  it("buckets the real Cito vocabulary", () => {
    expect(classifyMethod("U-DEC")).toBe("decision");
    expect(classifyMethod("S-DEC")).toBe("decision");
    expect(classifyMethod("M-DEC")).toBe("decision");
    expect(classifyMethod("Decision - Unanimous")).toBe("decision");
    expect(classifyMethod("KO/TKO")).toBe("ko");
    expect(classifyMethod("TKO - Doctor's Stoppage")).toBe("ko");
    expect(classifyMethod("SUB")).toBe("submission");
    expect(classifyMethod("Submission")).toBe("submission");
  });

  it("excludes non-competitive outcomes and nulls", () => {
    expect(classifyMethod("CNC")).toBeNull();
    expect(classifyMethod("DQ")).toBeNull();
    expect(classifyMethod("Overturned")).toBeNull();
    expect(classifyMethod("Could Not Continue")).toBeNull();
    expect(classifyMethod("Other")).toBeNull();
    expect(classifyMethod(null)).toBeNull();
    expect(classifyMethod(undefined)).toBeNull();
  });
});

/** Build a fighter whose fights are all wins by `winMethod` and losses by `lossMethod`. */
function fighter(id: string, winMethod: string, wins: number, lossMethod: string, losses: number): UfcFighterHistory {
  const fights: UfcFightRecord[] = [];
  let month = 1;
  for (let i = 0; i < wins; i++) fights.push(rec(id, "win", winMethod, month++));
  for (let i = 0; i < losses; i++) fights.push(rec(id, "loss", lossMethod, month++));
  return { fighterId: id, fighterSlug: id, fighterName: id, fights };
}

function rec(id: string, result: "win" | "loss", method: string, monthsAgo: number): UfcFightRecord {
  const eventDate = new Date(NOW.getTime() - monthsAgo * 30 * 24 * 3600 * 1000);
  return {
    boutId: `${id}-${monthsAgo}`,
    eventDate,
    opponentId: "opp",
    opponentSlug: "opp",
    opponentName: "opp",
    opponentImageUrl: null,
    result,
    method,
    resultRound: null,
    myStats: null,
    opponentStats: null,
  };
}

describe("computeFinishProjection", () => {
  it("returns unavailable when win prob is null", () => {
    const matchup: UfcMatchup = { fighterA: fighter("a", "KO/TKO", 8, "U-DEC", 2), fighterB: fighter("b", "SUB", 8, "U-DEC", 2), crossBouts: [] };
    const p = computeFinishProjection(matchup, null, 3, NOW);
    expect(p.available).toBe(false);
    expect(p.rounds).toHaveLength(3);
  });

  it("method + round distributions are proper probabilities", () => {
    const matchup: UfcMatchup = { fighterA: fighter("a", "KO/TKO", 8, "U-DEC", 2), fighterB: fighter("b", "U-DEC", 8, "KO/TKO", 2), crossBouts: [] };
    const p = computeFinishProjection(matchup, 0.6, 3, NOW);
    expect(p.available).toBe(true);
    const methodSum = p.method.ko + p.method.submission + p.method.decision;
    expect(methodSum).toBeCloseTo(1, 5);
    const roundSum = p.rounds.reduce((s, x) => s + x, 0);
    expect(roundSum).toBeCloseTo(1, 5);
    expect(p.finishProb + p.goesTheDistanceProb).toBeCloseTo(1, 5);
  });

  it("a KO fighter vs a chinny opponent skews toward KO over the base rate", () => {
    // A wins by KO; B loses by KO (bad chin) — KO should exceed the 33% base rate.
    const matchup: UfcMatchup = { fighterA: fighter("a", "KO/TKO", 10, "U-DEC", 1), fighterB: fighter("b", "U-DEC", 4, "KO/TKO", 10), crossBouts: [] };
    const p = computeFinishProjection(matchup, 0.65, 3, NOW);
    expect(p.method.ko).toBeGreaterThan(0.33);
    expect(p.method.ko).toBeGreaterThan(p.method.submission);
  });

  it("finish rounds skew early; final round carries the decision mass", () => {
    const matchup: UfcMatchup = { fighterA: fighter("a", "KO/TKO", 8, "U-DEC", 2), fighterB: fighter("b", "SUB", 8, "U-DEC", 2), crossBouts: [] };
    const p = computeFinishProjection(matchup, 0.55, 3, NOW);
    // R1 finish share > R2 finish share (early skew), but the final round is
    // lifted by the decision mass, so just assert the early-skew on finishes.
    const r1FinishOnly = p.finishProb * (2498 / (2498 + 1439 + 703));
    expect(p.rounds[0]).toBeCloseTo(r1FinishOnly, 5);
    expect(p.rounds[2]).toBeGreaterThan(p.goesTheDistanceProb); // final round = decision + some finishes
  });

  it("5-round bouts produce 5 round buckets", () => {
    const matchup: UfcMatchup = { fighterA: fighter("a", "KO/TKO", 8, "U-DEC", 2), fighterB: fighter("b", "SUB", 8, "U-DEC", 2), crossBouts: [] };
    const p = computeFinishProjection(matchup, 0.5, 5, NOW);
    expect(p.rounds).toHaveLength(5);
    expect(p.rounds.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
  });
});
