import { describe, expect, it } from "vitest";
import { rng } from "@/lib/audit/performance";
import { DECISION_GAMES, clusterMean, evRule, independence, lossGain, readGain, scoreOf, type ForwardRow } from "./forwardEval";

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const lg = (p: number) => Math.log(p / (1 - p));

/**
 * Synthetic slate: each game has 10 props; the truth is the books' chance plus
 * `signal` × a piece of information only "informed" sees. "noise" sees nothing
 * the books don't, plus noise.
 */
function rows(games: number, signal: number, seed = 5): ForwardRow[] {
  const next = rng(seed);
  const out: ForwardRow[] = [];
  for (let g = 0; g < games; g++)
    for (let k = 0; k < 10; k++) {
      const market = 0.3 + 0.4 * next();
      const info = next() * 2 - 1;
      const truth = sig(lg(market) + signal * info);
      const y = (next() < truth ? 1 : 0) as 0 | 1;
      out.push({
        cluster: `g${g}`,
        day: `2026-11-${String(17 + Math.floor(g / 10)).padStart(2, "0")}`,
        stat: k % 2 ? "points" : "pointsReboundsAssists",
        combo: k % 2 === 0,
        y,
        p: { market, prodRaw: sig(lg(market) + (next() * 2 - 1)), prodModel: market, prodBlend: market, prodShown: market, s1: truth, s2: truth, corr: market, v2: truth },
        overPrice: -110,
        underPrice: -110,
        closeOver: market,
        absZ: 0.4,
      });
    }
  return out;
}

describe("scores", () => {
  it("a perfect forecaster has zero Brier and zero calibration error", () => {
    const r = rows(20, 0).map((x) => ({ ...x, p: { ...x.p, s2: x.y } }));
    const s = scoreOf(r, "s2");
    expect(s.brier).toBe(0);
    expect(s.ece).toBeCloseTo(0, 9);
    expect(s.games).toBe(20);
  });

  it("leaves a forecaster's missing rows out", () => {
    const r = rows(5, 0);
    r[0].p.market = null;
    expect(scoreOf(r, "market").n).toBe(r.length - 1);
  });
});

describe("game-clustered comparisons", () => {
  it("the interval resamples whole games and contains the estimate", () => {
    const r = rows(40, 0);
    const m = clusterMean(r, (x) => x.y);
    expect(m.games).toBe(40);
    expect(m.lo!).toBeLessThanOrEqual(m.est!);
    expect(m.hi!).toBeGreaterThanOrEqual(m.est!);
  });

  it("credits a forecaster that knows something the books don't, and not one that only adds noise", () => {
    const r = rows(300, 1.5);
    const informed = lossGain(r, "s2", "market");
    expect(informed.lo!).toBeGreaterThan(0);
    const noise = lossGain(r, "prodRaw", "market");
    expect(noise.hi!).toBeLessThan(0);
    expect(readGain(informed, informed.games)).toMatch(/^decision: better than the books/);
    expect(readGain(noise, 10)).toMatch(/^interim \(10 of 250 games\): worse/);
  });

  it("independence: weight near 1 for real information, near 0 for none", () => {
    const r = rows(300, 1.5);
    const informed = independence(r, "s2");
    expect(informed.weight.lo!).toBeGreaterThan(0.5);
    expect(informed.chrono.gainLo!).toBeGreaterThan(0);
    const none = independence(r, "prodRaw");
    expect(none.weight.lo!).toBeLessThan(0);
    expect(none.weight.hi!).toBeGreaterThan(0);
  });
});

describe("the fixed EV rule", () => {
  it("bets the side with positive EV at the captured price and scores it at that price", () => {
    const base = rows(2, 0)[0];
    const r: ForwardRow[] = [
      { ...base, cluster: "a", y: 1, p: { ...base.p, s2: 0.6, market: 0.5 }, closeOver: 0.55 }, // Over at -110: EV +14.5%, wins, market moved to it
      { ...base, cluster: "b", y: 1, p: { ...base.p, s2: 0.4, market: 0.5 }, closeOver: 0.45 }, // Under: loses, market moved to it
      { ...base, cluster: "c", y: 0, p: { ...base.p, s2: 0.5, market: 0.5 } }, // no edge at -110 either way: no bet
    ];
    const res = evRule(r, "s2");
    expect(res.bets).toBe(2);
    expect(res.overs).toBe(1);
    expect(res.roi.est!).toBeCloseTo((100 / 110 - 1) / 2, 6);
    expect(res.clv.est!).toBeCloseTo(0.05, 9);
  });

  it("needs both prices", () => {
    const r = rows(1, 0).map((x) => ({ ...x, underPrice: null }));
    expect(evRule(r, "s2").bets).toBe(0);
  });
});

it("the decision point is pre-registered", () => {
  expect(DECISION_GAMES).toBe(250);
});
