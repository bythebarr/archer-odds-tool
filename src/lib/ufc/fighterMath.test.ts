import { describe, expect, it } from "vitest";
import { computeUfcWinProbability } from "./fighterMath";
import type { UfcFighterHistory, UfcFightRecord, UfcFightResult, UfcMatchup } from "@/lib/queries/ufcMatchup";
import type { UfcBoutFighterStats } from "@/generated/prisma/client";

const NOW = new Date("2026-07-07T00:00:00Z");

function monthsAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 30.44 * 24 * 3600 * 1000);
}

function stats(overrides: Partial<UfcBoutFighterStats> = {}): UfcBoutFighterStats {
  return {
    id: "stats-1",
    boutId: "bout-1",
    fighterId: "fighter-1",
    knockdowns: 0,
    submissionAttempts: 0,
    reversals: 0,
    controlTimeSeconds: 60,
    significantStrikesLanded: 30,
    significantStrikesAttempted: 60,
    totalStrikesLanded: 40,
    totalStrikesAttempted: 70,
    takedownsLanded: 1,
    takedownsAttempted: 2,
    headStrikesLanded: 20,
    headStrikesAttempted: 40,
    bodyStrikesLanded: 5,
    bodyStrikesAttempted: 10,
    legStrikesLanded: 5,
    legStrikesAttempted: 10,
    distanceStrikesLanded: 25,
    distanceStrikesAttempted: 50,
    clinchStrikesLanded: 3,
    clinchStrikesAttempted: 6,
    groundStrikesLanded: 2,
    groundStrikesAttempted: 4,
    ...overrides,
  };
}

function fight(overrides: Partial<UfcFightRecord> = {}): UfcFightRecord {
  return {
    boutId: `bout-${Math.random()}`,
    eventDate: monthsAgo(1),
    opponentId: "opp-default",
    opponentSlug: "opp-default",
    opponentName: "Default Opponent",
    opponentImageUrl: null,
    result: "win" as UfcFightResult,
    method: "Decision - Unanimous",
    resultRound: 3,
    myStats: null,
    opponentStats: null,
    ...overrides,
  };
}

/** N decision wins, evenly spaced, most recent 1 month ago — a "full confidence, no layoff, moderate quality" baseline. */
function steadyWins(count: number, opponentPrefix = "opp"): UfcFightRecord[] {
  return Array.from({ length: count }, (_, i) =>
    fight({
      boutId: `bout-${opponentPrefix}-${i}`,
      eventDate: monthsAgo(1 + i * 3),
      opponentId: `${opponentPrefix}-${i}`,
      opponentSlug: `${opponentPrefix}-${i}`,
      opponentName: `${opponentPrefix} ${i}`,
    })
  );
}

function fighterHistory(fights: UfcFightRecord[], overrides: Partial<UfcFighterHistory> = {}): UfcFighterHistory {
  return {
    fighterId: "fighter-a",
    fighterSlug: "fighter-a",
    fighterName: "Fighter A",
    fights,
    ...overrides,
  };
}

function matchup(overrides: Partial<UfcMatchup> = {}): UfcMatchup {
  return {
    fighterA: fighterHistory(steadyWins(8, "a-opp"), { fighterId: "a", fighterSlug: "a", fighterName: "Fighter A" }),
    fighterB: fighterHistory(steadyWins(8, "b-opp"), { fighterId: "b", fighterSlug: "b", fighterName: "Fighter B" }),
    crossBouts: [],
    ...overrides,
  };
}

describe("computeUfcWinProbability", () => {
  it("is close to even when both fighters have identical records and no shared opponents", () => {
    const { fighterAProb, fighterBProb } = computeUfcWinProbability(matchup(), NOW);
    expect(fighterAProb!).toBeCloseTo(0.5, 2);
    expect(fighterAProb! + fighterBProb!).toBeCloseTo(1, 10);
  });

  it("favors the fighter who beat a shared opponent that the other fighter lost to", () => {
    const baseline = computeUfcWinProbability(matchup(), NOW);
    const withEdge = computeUfcWinProbability(
      matchup({
        fighterA: fighterHistory(
          [...steadyWins(8, "a-opp"), fight({ opponentId: "shared", opponentSlug: "shared", opponentName: "Shared Foe", eventDate: monthsAgo(2), result: "win", method: "KO/TKO" })],
          { fighterId: "a", fighterSlug: "a", fighterName: "Fighter A" }
        ),
        fighterB: fighterHistory(
          [...steadyWins(8, "b-opp"), fight({ opponentId: "shared", opponentSlug: "shared", opponentName: "Shared Foe", eventDate: monthsAgo(2), result: "loss", method: "KO/TKO" })],
          { fighterId: "b", fighterSlug: "b", fighterName: "Fighter B" }
        ),
      }),
      NOW
    );
    expect(withEdge.fighterAProb!).toBeGreaterThan(baseline.fighterAProb!);
    expect(withEdge.commonOpponentAdjustment.details.some((d) => d.hopDistance === 1)).toBe(true);
  });

  it("favors the fighter with a clear takedown-offense-vs-defense style edge", () => {
    const grappler = fighterHistory(
      steadyWins(8, "a-opp").map((f, i) => ({
        ...f,
        myStats: stats({ id: `a-my-${i}`, fighterId: "a", takedownsLanded: 5, takedownsAttempted: 6 }),
        opponentStats: stats({ id: `a-opp-${i}`, fighterId: f.opponentId, takedownsLanded: 0, takedownsAttempted: 1 }),
      })),
      { fighterId: "a", fighterSlug: "a", fighterName: "Fighter A" }
    );
    const weakDefense = fighterHistory(
      steadyWins(8, "b-opp").map((f, i) => ({
        ...f,
        myStats: stats({ id: `b-my-${i}`, fighterId: "b", takedownsLanded: 0, takedownsAttempted: 1 }),
        opponentStats: stats({ id: `b-opp-${i}`, fighterId: f.opponentId, takedownsLanded: 4, takedownsAttempted: 5 }),
      })),
      { fighterId: "b", fighterSlug: "b", fighterName: "Fighter B" }
    );

    const baseline = computeUfcWinProbability(matchup(), NOW);
    const withStyleEdge = computeUfcWinProbability(matchup({ fighterA: grappler, fighterB: weakDefense }), NOW);

    expect(withStyleEdge.fighterAProb!).toBeGreaterThan(baseline.fighterAProb!);
    expect(withStyleEdge.styleAdjustment.details.length).toBeGreaterThan(0);
  });

  it("discounts a small-sample undefeated record instead of trusting it at full strength", () => {
    const rookie = fighterHistory(
      [
        fight({ opponentId: "r1", opponentSlug: "r1", eventDate: monthsAgo(2), result: "win", method: "KO/TKO" }),
        fight({ opponentId: "r2", opponentSlug: "r2", eventDate: monthsAgo(6), result: "win", method: "KO/TKO" }),
      ],
      { fighterId: "a", fighterSlug: "a", fighterName: "Rookie" }
    );
    const veteran = fighterHistory(
      steadyWins(8, "v-opp").map((f) => ({ ...f, result: "win" as UfcFightResult, method: "KO/TKO" })),
      { fighterId: "a2", fighterSlug: "a2", fighterName: "Veteran" }
    );
    // A neutral (resultQuality exactly 0.5, all draws) opponent — isolates
    // the sample-size effect instead of comparing against matchup()'s
    // default 0.75-quality baseline, which would confound the comparison.
    const neutralOpponent = fighterHistory(
      steadyWins(8, "neutral-opp").map((f) => ({ ...f, result: "draw" as UfcFightResult })),
      { fighterId: "b", fighterSlug: "b", fighterName: "Neutral" }
    );

    const rookieResult = computeUfcWinProbability(matchup({ fighterA: rookie, fighterB: neutralOpponent }), NOW);
    const veteranResult = computeUfcWinProbability(matchup({ fighterA: veteran, fighterB: neutralOpponent }), NOW);

    // Both are "undefeated by finish" (raw quality 1.0), but the veteran's
    // full sample should be trusted more than the rookie's 2-fight sample.
    expect(rookieResult.fighterAProb!).toBeGreaterThan(0.5);
    expect(rookieResult.fighterAProb!).toBeLessThan(veteranResult.fighterAProb!);
  });

  it("shrinks a long-idle fighter's strength toward neutral despite a perfect record", () => {
    const idleChampion = fighterHistory(
      steadyWins(8, "idle-opp")
        .map((f) => ({ ...f, result: "win" as UfcFightResult, method: "KO/TKO" }))
        .map((f, i) => ({ ...f, eventDate: monthsAgo(40 + i * 3) })), // most recent fight 40 months ago
      { fighterId: "a", fighterSlug: "a", fighterName: "Idle Champion" }
    );

    const result = computeUfcWinProbability(matchup({ fighterA: idleChampion }), NOW);
    expect(result.fighterAStrength!).toBeCloseTo(0.5, 1);
  });

  it("returns null probabilities when a fighter has no completed-bout history", () => {
    const result = computeUfcWinProbability(matchup({ fighterA: fighterHistory([], { fighterId: "a" }) }), NOW);
    expect(result.fighterAProb).toBeNull();
    expect(result.fighterBProb).toBeNull();
    expect(result.fighterAStrength).toBeNull();
  });

  it("caps win probability even when every layer points the same direction", () => {
    const dominant = fighterHistory(
      steadyWins(8, "dom-opp").map((f, i) => ({
        ...f,
        result: "win" as UfcFightResult,
        method: "KO/TKO",
        myStats: stats({ id: `dom-my-${i}`, fighterId: "a", takedownsLanded: 8, significantStrikesLanded: 100 }),
        opponentStats: stats({ id: `dom-opp-${i}`, fighterId: f.opponentId, takedownsLanded: 0, significantStrikesLanded: 5 }),
      })),
      { fighterId: "a", fighterSlug: "a", fighterName: "Dominant" }
    );
    const overmatched = fighterHistory(
      steadyWins(8, "weak-opp").map((f, i) => ({
        ...f,
        result: "loss" as UfcFightResult,
        method: "KO/TKO",
        myStats: stats({ id: `weak-my-${i}`, fighterId: "b", takedownsLanded: 0, significantStrikesLanded: 5 }),
        opponentStats: stats({ id: `weak-opp-${i}`, fighterId: f.opponentId, takedownsLanded: 8, significantStrikesLanded: 100 }),
      })),
      { fighterId: "b", fighterSlug: "b", fighterName: "Overmatched" }
    );

    const result = computeUfcWinProbability(matchup({ fighterA: dominant, fighterB: overmatched }), NOW);
    expect(result.fighterAProb!).toBeCloseTo(0.8, 10);
    expect(result.fighterBProb!).toBeCloseTo(0.2, 10);
  });
});
