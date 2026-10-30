import { describe, expect, it } from "vitest";
import { buildParlays, type BuilderOptions } from "./build";
import { edgeOf, ratesOf, type BuilderLeg } from "./types";

const leg = (id: string, over: Partial<BuilderLeg> = {}): BuilderLeg => ({
  id,
  sport: "nba",
  league: "NBA",
  eventId: `e-${id}`,
  eventLabel: "A @ B",
  startsAt: "2026-10-30T23:00:00Z",
  href: "/",
  kind: "prop",
  label: id,
  group: `g-${id}`,
  priceAmerican: -150,
  bookName: "DraftKings",
  archr: 0.65,
  edge: edgeOf(0.65, -150),
  rates: { l5: [4, 5], l10: [8, 10], l20: [15, 20], season: [8, 10] },
  ...over,
});

const opts: BuilderOptions = { sports: [], legs: 2, window: "l10", minRate: 0.7, minArchr: 0, minEdge: null, sameGame: false, shortest: -Infinity, sort: "archr" };

describe("buildParlays", () => {
  it("stacks the best qualifying legs, multiplying chances and prices", () => {
    const { parlays } = buildParlays([leg("a", { archr: 0.8 }), leg("b", { archr: 0.7 }), leg("c", { archr: 0.6 })], opts);
    expect(parlays[0].legs.map((l) => l.id)).toEqual(["a", "b"]);
    expect(parlays[0].archr).toBeCloseTo(0.56);
    expect(parlays[0].record).toBeCloseTo(0.64);
    expect(parlays[0].priceAmerican).toBe(178);
  });

  it("filters by sport, window record, ARCHR chance and edge", () => {
    const pool = [
      leg("nfl", { sport: "nfl" }),
      leg("cold", { rates: { l5: [5, 5], l10: [5, 10], l20: [10, 20], season: [5, 10] } }),
      leg("noRead", { archr: null, edge: null }),
      leg("plusEv", { archr: 0.7, edge: edgeOf(0.7, -150) }),
      leg("ok"),
    ];
    expect(buildParlays(pool, { ...opts, sports: ["nba"] }).qualifying).toBe(3);
    expect(buildParlays(pool, { ...opts, minArchr: 0.6 }).qualifying).toBe(3);
    expect(buildParlays(pool, { ...opts, minEdge: 0.1 }).parlays).toEqual([]);
    expect(buildParlays(pool, { ...opts, window: "l5", minRate: 0.9 }).qualifying).toBe(1);
  });

  it("takes one leg per game unless same-game legs are allowed, and never two of one market", () => {
    const pool = [leg("a", { eventId: "g1" }), leg("b", { eventId: "g1" }), leg("c", { eventId: "g1", group: "g-a" })];
    expect(buildParlays(pool, opts).parlays).toEqual([]);
    const sgp = buildParlays(pool, { ...opts, sameGame: true }).parlays[0];
    expect(sgp.legs.map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("returns different parlays, each leg in at most two", () => {
    const pool = ["a", "b", "c", "d", "e"].map((id, i) => leg(id, { archr: 0.9 - i * 0.05 }));
    const { parlays } = buildParlays(pool, { ...opts, count: 4 });
    expect(new Set(parlays.map((p) => p.legs.map((l) => l.id).join())).size).toBe(parlays.length);
    const uses = new Map<string, number>();
    for (const p of parlays) for (const l of p.legs) uses.set(l.id, (uses.get(l.id) ?? 0) + 1);
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(2);
  });

  it("leaves out legs shorter than the shortest price allowed, priced or (by ARCHR) unpriced", () => {
    const pool = [leg("short", { priceAmerican: -700 }), leg("sureUnpriced", { priceAmerican: null, archr: 0.9 }), leg("ok", { priceAmerican: -200 }), leg("okUnpriced", { priceAmerican: null, archr: 0.7 })];
    expect(buildParlays(pool, { ...opts, shortest: -500 }).qualifying).toBe(2);
  });

  it("doesn't count an edge too big to trust", () => {
    const pool = [leg("wild", { priceAmerican: 500, archr: 0.45, edge: edgeOf(0.45, 500) }), leg("fair", { archr: 0.65, edge: 0.04 })];
    expect(buildParlays(pool, { ...opts, minEdge: 0.03 }).qualifying).toBe(1);
  });
});

describe("ratesOf", () => {
  it("counts each window from the newest games", () => {
    const outcomes = Array.from({ length: 25 }, (_, i) => ({ hit: i % 2 === 0, season: i < 12 ? 2026 : 2025 }));
    expect(ratesOf(outcomes, 2026)).toEqual({ l5: [3, 5], l10: [5, 10], l20: [10, 20], season: [6, 12] });
  });
});
