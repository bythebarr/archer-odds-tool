import { describe, expect, it } from "vitest";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { optimizeParlays } from "./optimize";
import { conservativeProb, recordFloor, relativeEdge } from "./conservative";
import type { BuilderLeg } from "./types";

function leg(id: string, event: string, price: number, archr: number, hits: number, n = 10): BuilderLeg {
  return {
    id,
    sport: "nba",
    league: "NBA",
    eventId: event,
    eventLabel: event,
    startsAt: "2026-11-02T00:00:00Z",
    href: "/",
    kind: "prop",
    label: id,
    group: `${event}:${id}`,
    priceAmerican: price,
    bookName: "DraftKings",
    archr,
    edge: null,
    rates: { l5: [Math.min(hits, 5), 5], l10: [hits, n], l20: [hits, n], season: [hits, n] },
  };
}

describe("conservative chance and relative edge", () => {
  it("takes the lower of ARCHR and the record's floor", () => {
    expect(conservativeProb(0.9, [9, 10])).toBeCloseTo(Math.min(0.9, recordFloor(9, 10)));
    expect(conservativeProb(0.5, [9, 10])).toBe(0.5);
    expect(conservativeProb(null, [9, 10])).toBeCloseTo(recordFloor(9, 10));
    expect(conservativeProb(0.6, [2, 2])).toBe(0.6);
    expect(conservativeProb(null, [0, 0])).toBeNull();
  });

  it("compares it with the price's implied chance", () => {
    expect(relativeEdge(0.55, -110)).toBeCloseTo(0.55 / (110 / 210) - 1);
    expect(relativeEdge(0.4, 150)).toBeCloseTo(0);
    expect(relativeEdge(null, 150)).toBeNull();
  });
});

describe("optimizeParlays", () => {
  // Deterministic pseudo-random pool: 12 games, 1–3 legs each.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool: BuilderLeg[] = [];
  for (let g = 0; g < 12; g++) {
    for (let i = 0; i < 1 + (g % 3); i++) {
      const price = [-400, -250, -180, -130, 100, 140, 200][Math.floor(rnd() * 7)];
      pool.push(leg(`g${g}l${i}`, `g${g}`, price, 0.4 + rnd() * 0.5, 5 + Math.floor(rnd() * 6)));
    }
  }
  const probOf = (l: BuilderLeg) => conservativeProb(l.archr, l.rates.l10)!;

  /** Every combination, one leg per game, by brute force. */
  function bruteBest(target: number, legs: number | null) {
    const byGame = new Map<string, BuilderLeg[]>();
    for (const l of pool) byGame.set(l.eventId, [...(byGame.get(l.eventId) ?? []), l]);
    const games = [...byGame.values()];
    let best = 0;
    const walk = (i: number, n: number, dec: number, p: number) => {
      if (i === games.length) {
        if ((legs === null ? n >= 2 && n <= 8 : n === legs) && dec >= americanToDecimal(target) - 1e-9) best = Math.max(best, p);
        return;
      }
      walk(i + 1, n, dec, p);
      for (const l of games[i]) if (probOf(l) >= 0.3) walk(i + 1, n + 1, dec * americanToDecimal(l.priceAmerican!), p * probOf(l));
    };
    walk(0, 0, 1, 1);
    return best;
  }

  for (const [target, legs] of [
    [300, null],
    [500, 3],
    [150, 2],
    [1000, null],
  ] as const) {
    it(`finds the likeliest parlay paying at least +${target} (${legs ?? "any"} legs)`, () => {
      const { parlays } = optimizeParlays(pool, { target, legs, shortest: -Infinity });
      const best = bruteBest(target, legs);
      expect(parlays.length).toBeGreaterThan(0);
      const top = parlays[0];
      // Prices are binned to 1%: the optimizer may pass up a combination that clears the target by less than that.
      expect(top.prob).toBeGreaterThan(best * 0.97);
      expect(top.prob).toBeLessThanOrEqual(best + 1e-9);
      expect(top.priceAmerican).toBeGreaterThanOrEqual(target - 1);
      if (legs) expect(top.legs.length).toBe(legs);
      expect(new Set(top.legs.map((l) => l.eventId)).size).toBe(top.legs.length);
    });
  }

  it("returns different alternatives, likeliest first", () => {
    const { parlays } = optimizeParlays(pool, { target: 300, shortest: -Infinity });
    const keys = parlays.map((p) => p.legs.map((l) => l.id).sort().join());
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < parlays.length; i++) expect(parlays[i].prob).toBeLessThanOrEqual(parlays[i - 1].prob);
  });

  it("returns nothing when no combination reaches the payout", () => {
    expect(optimizeParlays(pool.slice(0, 2), { target: 100000, shortest: -Infinity }).parlays).toEqual([]);
  });
});
