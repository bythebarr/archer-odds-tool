import { describe, expect, it } from "vitest";
import { findParlays, parlayPrice, rateFloor, type FinderLeg } from "./parlayFinder";

/** 30 games between BOS and NYK; `values(i)` is the stat in game i (0 = newest). */
function leg(key: string, team: string, side: "over" | "under", point: number, values: (i: number) => number | null, price: number | null = -110, group = key): FinderLeg {
  return {
    key,
    group,
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
