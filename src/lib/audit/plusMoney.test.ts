import { describe, expect, it } from "vitest";
import { chronoFactorTest, fadeRow, leaveOneOut, lookupOpposite, noVig, PRICE_BUCKETS, profitConcentration, residualCorrelation, slateFeasibility, Z_BUCKETS, type Quote } from "./plusMoney";
import { logit, rng, sigmoid } from "./performance";

const t = (iso: string) => new Date(iso);
const q = (side: string, point: number, price: number, at: string, bookKey = "draftkings"): Quote => ({ side, point, bookKey, priceAmerican: price, polledAt: t(at) });

describe("buckets", () => {
  it("cover each price and distance once", () => {
    for (const a of [-300, -110, 100, 124, 125, 150, 174, 175, 199, 200, 450]) expect(PRICE_BUCKETS.filter((b) => b.test(a)).length).toBe(1);
    for (const z of [0, 0.19, 0.2, 0.35, 0.55, 0.75, 1, 1.5, 6]) expect(Z_BUCKETS.filter((b) => b.test(z)).length).toBe(1);
    expect(Z_BUCKETS.filter((b) => b.test(7)).length).toBe(0);
  });
});

describe("the opposite side, from recorded quotes only", () => {
  const quotes = [
    q("over", 20.5, -115, "2026-11-13T20:00:00Z"),
    q("under", 20.5, -105, "2026-11-13T20:00:00Z"),
    q("under", 20.5, -120, "2026-11-13T23:30:00Z"), // after the decision: not used for the decision, used for the close
    q("over", 20.5, 100, "2026-11-13T23:30:00Z"),
    q("under", 21.5, -140, "2026-11-13T20:00:00Z"), // another line
    q("under", 20.5, -150, "2026-11-13T20:00:00Z", "fanduel"), // another book
  ];
  const pick = { side: "over" as const, point: 20.5, bookKey: "draftkings", price: -115, decidedAt: t("2026-11-13T21:00:00Z").getTime(), startsAt: t("2026-11-14T00:00:00Z").getTime() };

  it("takes the latest other-side quote at or before the decision, same book and line, and checks the pick's own price", () => {
    const r = lookupOpposite(quotes, pick);
    expect(r.opposite?.priceAmerican).toBe(-105);
    expect(r.identityOk).toBe(true);
    expect(r.closingOpposite?.priceAmerican).toBe(-120);
    expect(r.closingSame?.priceAmerican).toBe(100);
  });

  it("has no price when none was recorded, and flags a pick whose price doesn't match", () => {
    expect(lookupOpposite(quotes, { ...pick, point: 30.5 }).opposite).toBeNull();
    expect(lookupOpposite(quotes, { ...pick, decidedAt: t("2026-11-13T19:00:00Z").getTime() }).opposite).toBeNull();
    expect(lookupOpposite(quotes, { ...pick, price: -130 }).identityOk).toBe(false);
  });

  it("scores the fade at its own price: it wins when the pick lost", () => {
    const f = fadeRow({ cluster: "g", won: 0, p: 0.55 }, -105, -115, { opp: -120, same: 100 });
    expect(f.won).toBe(1);
    expect(f.p).toBeCloseTo(0.45);
    expect(f.market).toBeCloseTo(noVig(-105, -115));
    expect(f.close!).toBeGreaterThan(f.market!);
  });
});

describe("chronological factor test", () => {
  it("credits a real effect on unseen games and not a null one", () => {
    const next = rng(9);
    const make = (n: number, effect: number, offset = 0) =>
      Array.from({ length: n }, (_, i) => {
        const x = next() < 0.5 ? 1 : 0;
        return { cluster: `g${offset + (i % 100)}`, market: 0.5, x: [x], won: (next() < sigmoid(logit(0.5) + effect * x) ? 1 : 0) as 0 | 1 };
      });
    const real = chronoFactorTest(make(4000, 0.5), make(3000, 0.5, 1000));
    expect(real.coef!).toBeGreaterThan(0.3);
    expect(real.gainLo!).toBeGreaterThan(0);
    const none = chronoFactorTest(make(4000, 0), make(3000, 0, 1000));
    expect(none.gainLo!).toBeLessThan(0);
  });
});

describe("robustness and feasibility", () => {
  const rows = [
    { cluster: "g1", day: "d1", won: 1 as const, p: 0.5, market: 0.5, price: 100, close: null, player: "a" },
    { cluster: "g1", day: "d1", won: 1 as const, p: 0.5, market: 0.5, price: 100, close: null, player: "a" },
    { cluster: "g2", day: "d2", won: 0 as const, p: 0.5, market: 0.5, price: 100, close: null, player: "b" },
  ];

  it("leaves each day out in turn and measures profit concentration", () => {
    expect(leaveOneOut(rows, (r) => r.day).map((x) => x.roi)).toEqual([-1, 1]);
    expect(profitConcentration(rows, (r) => r.player)).toEqual({ top: "a", share: 2 });
  });

  it("counts qualifying picks per slate and the days that reach six", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ cluster: `g${i % 4}`, day: i < 8 ? "d1" : "d2", ok: i % 2 === 0 }));
    const f = slateFeasibility(many, (r) => r.ok, 4);
    expect(f).toMatchObject({ days: 2, min: 3, max: 4, daysWithK: 1 });
  });

  it("separates same-game from other-game residual correlation", () => {
    const r = residualCorrelation([
      { cluster: "g1", day: "d", won: 1, market: 0.5, p: 0.5 },
      { cluster: "g1", day: "d", won: 1, market: 0.5, p: 0.5 },
      { cluster: "g2", day: "d", won: 0, market: 0.5, p: 0.5 },
    ]);
    expect(r.sameGame).toBeCloseTo(1);
    expect(r.otherGame).toBeCloseTo(-1);
  });
});
