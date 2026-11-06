import { describe, expect, it } from "vitest";
import { findStacks } from "./stackFinder";
import type { FinderLeg } from "./parlayFinder";

const DATES = Array.from({ length: 12 }, (_, i) => new Date(Date.parse("2026-10-31T12:00:00Z") - i * 2 * 86_400_000).toISOString().slice(0, 10));

/** A leg on `player` whose stat ran `values` (newest first; null = didn't play). */
function leg(player: string, stat: string, point: number, values: (number | null)[], price: number | null = -110): FinderLeg {
  return {
    key: `${player}:${stat}:over:${point}`,
    group: `${player}:${stat}`,
    player,
    id: `${player}:${stat}`,
    gameId: "g1",
    playerName: player,
    team: "BOS",
    statShort: stat,
    side: "over",
    sideLabel: "Over",
    point,
    modelProb: 0.6,
    priceAmerican: price,
    bookName: "DraftKings",
    logs: values.map((value, i) => ({ date: DATES[i], opponent: "NYK", isHome: i % 2 === 0, season: 2026, team: "BOS", value })),
  };
}

// A scores 30 in the first 8 games, 10 after; B grabs 12 boards in the first 8; C sits game 2.
const A = [30, 30, 30, 30, 30, 30, 30, 30, 10, 10, 10, 10];
const B = [12, 12, 12, 12, 12, 12, 12, 12, 4, 4, 4, 4];
const C: (number | null)[] = [8, null, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];

describe("findStacks", () => {
  const legs = [leg("A", "PTS", 24.5, A), leg("A", "PTS", 9.5, A, -900), leg("B", "REB", 9.5, B), leg("B", "REB", 3.5, B, -1000), leg("C", "AST", 6.5, C)];

  it("finds each player's line that cashed together most, in the games they all played", () => {
    const r = findStacks(legs, ["A", "B", "C"], { minShared: 5 });
    expect(r.together).toBe(11);
    const best = r.stacks[0];
    // The low rungs hit every game they shared.
    expect(best.legs.map((l) => l.key)).toEqual(["A:PTS:over:9.5", "B:REB:over:3.5", "C:AST:over:6.5"]);
    expect(best.hits).toBe(11);
    expect(best.shared).toBe(11);
  });

  it("ranks by payout among stacks that cleared the bar", () => {
    const r = findStacks(legs, ["A", "B"], { minShared: 5, rank: "payout", minRate: 0.6 });
    // The real lines (24.5 / 9.5) hit 8 of 12 together and pay far more than the low rungs.
    expect(r.stacks[0].legs.map((l) => l.point)).toEqual([24.5, 9.5]);
    expect(r.stacks[0].hits).toBe(8);
  });

  it("needs two players and enough games together", () => {
    expect(findStacks(legs, ["A"]).stacks).toEqual([]);
    expect(findStacks(legs, ["A", "C"], { minShared: 20 }).stacks).toEqual([]);
  });
});
