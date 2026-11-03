import { describe, expect, it } from "vitest";
import { fairAmerican, generateParlay, type GenerateOptions } from "./generate";
import { edgeOf, type BuilderLeg } from "./types";

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

const opts: GenerateOptions = {
  sports: [],
  legs: 3,
  window: "l10",
  minRate: 0.7,
  minArchr: 0,
  minEdge: null,
  sameGame: false,
  shortest: -Infinity,
  sort: "archr",
  kinds: [],
  pricedOnly: false,
};
const run = (pool: BuilderLeg[], over: Partial<Parameters<typeof generateParlay>[1]> = {}) => generateParlay(pool, { ...opts, lockedIds: [], exclude: [], seed: 1, ...over });

const pool = Array.from({ length: 12 }, (_, i) => leg(`l${i}`, { archr: 0.6 + i / 100 }));

describe("generateParlay", () => {
  it("fills the parlay with qualifying legs, one per game", () => {
    const { parlay, short, qualifying } = run(pool);
    expect(parlay.legs).toHaveLength(3);
    expect(short).toBe(0);
    expect(qualifying).toBe(12);
    expect(new Set(parlay.legs.map((l) => l.eventId)).size).toBe(3);
  });

  it("draws the same parlay from the same seed and varies with it", () => {
    const ids = (seed: number) => run(pool, { seed }).parlay.legs.map((l) => l.id).join();
    expect(ids(5)).toBe(ids(5));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(ids)).size).toBeGreaterThan(1);
  });

  it("keeps locked legs and draws the rest around their games", () => {
    const sameGame = leg("same", { eventId: "e-l0", archr: 0.99 });
    const { parlay } = run([...pool, sameGame], { lockedIds: ["l0"] });
    expect(parlay.legs[0]).toMatchObject({ id: "l0", locked: true });
    expect(parlay.legs.some((l) => l.id === "same")).toBe(false);
    expect(parlay.legs.filter((l) => l.locked)).toHaveLength(1);
  });

  it("keeps a locked leg even when it no longer clears the filters", () => {
    const cold = leg("cold", { rates: { l5: [1, 5], l10: [2, 10], l20: [4, 20], season: [2, 10] } });
    const { parlay } = run([...pool, cold], { lockedIds: ["cold"] });
    expect(parlay.legs.map((l) => l.id)).toContain("cold");
  });

  it("leaves out the legs just shown when it can, and uses them when it must", () => {
    const first = run(pool).parlay.legs.map((l) => l.id);
    const next = run(pool, { exclude: first, seed: 9 }).parlay.legs.map((l) => l.id);
    expect(next.some((id) => first.includes(id))).toBe(false);
    const small = pool.slice(0, 3);
    expect(run(small, { exclude: small.map((l) => l.id) }).short).toBe(0);
  });

  it("says how many it is short when the filters don't leave enough games", () => {
    const { parlay, short } = run(pool.slice(0, 2), { legs: 5 });
    expect(parlay.legs).toHaveLength(2);
    expect(short).toBe(3);
  });

  it("filters by bet type and priced legs only", () => {
    const ml = leg("ml", { kind: "ml" });
    const unpriced = leg("unpriced", { priceAmerican: null, edge: null });
    expect(run([ml, ...pool.slice(0, 3)], { kinds: ["ml"], legs: 2 }).parlay.legs.map((l) => l.id)).toEqual(["ml"]);
    expect(run([unpriced, ...pool.slice(0, 2)], { pricedOnly: true }).parlay.legs.some((l) => l.id === "unpriced")).toBe(false);
  });

  it("prices an unpriced leg at ARCHR's fair price and marks the total as an estimate", () => {
    const unpriced = leg("unpriced", { priceAmerican: null, edge: null, archr: 0.8 });
    const { parlay } = run([unpriced], { legs: 1 });
    expect(parlay.legs[0]).toMatchObject({ displayPrice: -400, fair: true });
    expect(parlay.estimated).toBe(true);
    expect(parlay.priceAmerican).toBe(-400);
  });
});

describe("fairAmerican", () => {
  it("turns a chance into no-vig odds", () => {
    expect(fairAmerican(0.5)).toBe(100);
    expect(fairAmerican(0.25)).toBe(300);
    expect(fairAmerican(null)).toBeNull();
  });
});
