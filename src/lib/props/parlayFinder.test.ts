import { describe, expect, it } from "vitest";
import { findParlays, findTwoTeamParlays, parlayPrice, rateFloor, type FinderLeg } from "./parlayFinder";

/** 30 games between BOS and NYK; `values(i)` is the stat in game i (0 = newest). */
function leg(key: string, team: string, side: "over" | "under", point: number, values: (i: number) => number | null, price: number | null = -110, group = key, player = group): FinderLeg {
  return {
    key,
    group,
    player,
    id: group,
    gameId: "g",
    playerName: key,
    team,
    statShort: "PTS",
    side,
    sideLabel: side === "over" ? "Over" : "Under",
    point,
    modelProb: 0.6,
    priceAmerican: price,
    bookName: "DraftKings",
    logs: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(28 - (i % 28)).padStart(2, "0")}`,
      opponent: team === "BOS" ? "NYK" : "BOS",
      isHome: team === "BOS",
      season: 2026,
      value: values(i),
    })),
  };
}

describe("findParlays", () => {
  // A and B cash together (same games); C cashes in the other games; D every game but one.
  const a = leg("A", "BOS", "over", 20.5, (i) => (i % 3 === 0 ? 10 : 25));
  const b = leg("B", "NYK", "over", 8.5, (i) => (i % 3 === 0 ? 4 : 12));
  const c = leg("C", "BOS", "over", 5.5, (i) => (i % 3 === 0 ? 9 : 2));
  const d = leg("D", "NYK", "over", 1.5, (i) => (i === 5 ? 0 : 3));

  it("finds the legs that hit together, not just the ones that hit often", () => {
    const res = findParlays([a, b, c, d], { minLegRate: 0.3, minShared: 10 });
    const best2 = res.find((r) => r.size === 2)!.parlays[0];
    expect(best2.legs.map((l) => l.key).sort()).toEqual(["A", "B"]);
    // A and C never cash together, so no combination shown pairs them, and nothing reaches 4 legs.
    for (const r of res) for (const p of r.parlays) expect(p.legs.some((l) => l.key === "A") && p.legs.some((l) => l.key === "C")).toBe(false);
    expect(best2).toMatchObject({ hits: 20, shared: 30 });
    expect(res.map((r) => r.size)).toEqual([2, 3]);
  });

  it("counts a size-3 record as the games all three cashed", () => {
    const res = findParlays([a, b, d], { minLegRate: 0.3, minShared: 10 });
    expect(res.find((r) => r.size === 3)!.parlays[0]).toMatchObject({ hits: 19, shared: 30, last10: { shared: 10 } });
  });

  it("never puts two rungs of the same player's stat in one parlay", () => {
    const low = leg("A15", "BOS", "over", 15.5, () => 25, -400, "A");
    const res = findParlays([a, low, b], { minLegRate: 0.3, minShared: 10 });
    for (const r of res) for (const p of r.parlays) expect(new Set(p.legs.map((l) => l.group)).size).toBe(p.legs.length);
  });

  it("drops legs that rarely cash on their own and records below the shared-game floor", () => {
    const rare = leg("R", "BOS", "over", 40.5, (i) => (i === 0 ? 50 : 10));
    const res = findParlays([a, b, rare], { minLegRate: 0.6, minShared: 10 });
    for (const r of res) for (const p of r.parlays) expect(p.legs.some((l) => l.key === "R")).toBe(false);
    const fewShared = leg("F", "NYK", "over", 1.5, (i) => (i < 5 ? 9 : null));
    expect(findParlays([a, fewShared], { minLegRate: 0.3, minShared: 10 })).toEqual([]);
  });

  it("caps one player's legs, so a near-copy of his own stat can't crowd out the other players", () => {
    // A's points + assists moves with A's points every game: the best pair, on one player.
    const aPra = leg("A-PA", "BOS", "over", 25.5, (i) => (i % 3 === 0 ? 14 : 30), -110, "A-PA", "A");
    const aPts = { ...a, player: "A" };
    const free = findParlays([aPts, aPra, b], { minLegRate: 0.3, minShared: 10 });
    expect(free.find((r) => r.size === 2)!.parlays[0].legs.map((l) => l.player)).toEqual(["A", "A"]);
    const capped = findParlays([aPts, aPra, b], { minLegRate: 0.3, minShared: 10, maxPerPlayer: 1 });
    for (const r of capped) for (const p of r.parlays) expect(new Set(p.legs.map((l) => l.player)).size).toBe(p.legs.length);
    expect(capped.find((r) => r.size === 2)!.parlays.length).toBeGreaterThan(0);
  });

  it("shows each combination once, at its best rung", () => {
    const b2 = leg("B2", "NYK", "over", 7.5, (i) => (i % 3 === 0 ? 4 : 12), -150, "B");
    const res = findParlays([a, b, b2], { minLegRate: 0.3, minShared: 10 });
    const pairs = res.find((r) => r.size === 2)!.parlays.map((p) => p.legs.map((l) => l.group).sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("helpers", () => {
  it("prefers a longer record at a similar rate", () => {
    expect(rateFloor(28, 30)).toBeGreaterThan(rateFloor(9, 10));
    expect(rateFloor(0, 0)).toBe(0);
  });
  it("prices legs as if unrelated", () => {
    const l = (p: number | null) => ({ priceAmerican: p }) as FinderLeg;
    expect(parlayPrice([l(-110), l(-110)])).toBe(264);
    expect(parlayPrice([l(-110), l(null)])).toBeNull();
  });
});

describe("findParlays: each leg's own record", () => {
  it("reports how often each leg cashed in the games the combination shared", () => {
    const a = leg("A", "BOS", "over", 20.5, (i) => (i % 3 === 0 ? 10 : 25));
    const d = leg("D", "BOS", "over", 1.5, (i) => (i === 5 ? 0 : 3), -110, "D", "Dp");
    const p = findParlays([a, d], { minLegRate: 0.3, minShared: 10 }).find((r) => r.size === 2)!.parlays[0];
    const byKey = Object.fromEntries(p.legs.map((l, i) => [l.key, p.legHits[i]]));
    expect(byKey).toEqual({ A: 20, D: 29 });
  });
});

describe("findTwoTeamParlays", () => {
  const a = leg("A", "BOS", "over", 20.5, (i) => (i % 3 === 0 ? 10 : 25));
  const c = leg("C", "BOS", "over", 2.5, (i) => (i % 5 === 0 ? 1 : 4));
  const b = leg("B", "NYK", "over", 8.5, (i) => (i % 3 === 0 ? 4 : 12));
  const d = leg("D", "NYK", "over", 1.5, (i) => (i === 5 ? 0 : 3));

  it("puts legs from both teams in every parlay, the estimate the two sides' records multiplied", () => {
    const res = findTwoTeamParlays([a, b, c, d], { minLegRate: 0.3, minShared: 10, minRate: 0.3 });
    expect(res[0].size).toBe(2);
    for (const r of res)
      for (const p of r.parlays) {
        expect(new Set(p.legs.map((l) => l.team))).toEqual(new Set(["BOS", "NYK"]));
        const [x, y] = p.sides.map((s) => s.parlay.hits / s.parlay.shared);
        expect(p.estimate).toBeCloseTo(x * y);
        expect(p.legs.length).toBe(r.size);
      }
    // These teams meet in every fixture game, so the head-to-head record is the joint one.
    const ab = res[0].parlays.find((p) => p.legs.map((l) => l.key).sort().join() === "A,B")!;
    expect(ab.h2h).toEqual({ hits: 20, shared: 30 });
  });

  it("returns nothing without two teams", () => {
    expect(findTwoTeamParlays([a, c], { minLegRate: 0.3, minShared: 10 })).toEqual([]);
  });
});
