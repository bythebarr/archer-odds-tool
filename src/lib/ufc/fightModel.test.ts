import { describe, expect, it } from "vitest";
import { UfcReplay, dedupeBouts, fightSeconds, weightClassLbs, type BoutRecord, type FighterInfo } from "./fightModel";
import { fitLogistic, predictLogistic } from "@/lib/stats/logistic";

/** A deterministic league: fighter i has skill i; the more skilled fighter usually wins and outstrikes. */
function league(nFighters = 40, nBouts = 1500) {
  const fighters = new Map<string, FighterInfo>();
  for (let i = 0; i < nFighters; i++) fighters.set(`f${i}`, { id: `f${i}`, reachInches: 70 + (i % 7), recordWins: 10, recordLosses: 2, birthDate: new Date(Date.UTC(1990 + (i % 8), 0, 1)) });
  const bouts: BoutRecord[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < nBouts; k++) {
    const a = Math.floor(rand() * nFighters);
    let b = Math.floor(rand() * nFighters);
    if (b === a) b = (a + 1) % nFighters;
    const pA = 1 / (1 + Math.exp(-(a - b) / 8));
    const aWins = rand() < pA;
    const line = (skill: number) => ({ sigLanded: 30 + skill, sigAttempted: 70 + skill, tdLanded: 1, tdAttempted: 3, knockdowns: 0, subAttempts: 0, controlSeconds: 60 });
    bouts.push({
      id: `b${k}`,
      date: new Date(Date.UTC(2015, 0, 1) + k * 3 * 86_400_000),
      weightClass: "Lightweight",
      red: `f${a}`,
      blue: `f${b}`,
      winner: aWins ? `f${a}` : `f${b}`,
      method: k % 3 === 0 ? "KO/TKO" : "Decision - Unanimous",
      seconds: 900,
      redStats: line(a),
      blueStats: line(b),
    });
  }
  return { fighters, bouts };
}

describe("UfcReplay", () => {
  it("rates the better fighters higher", () => {
    const { fighters, bouts } = league();
    const r = new UfcReplay(fighters, bouts);
    for (const b of bouts) r.update(b);
    const now = new Date(Date.UTC(2030, 0, 1));
    expect(r.profile("f39", now).elo).toBeGreaterThan(r.profile("f0", now).elo + 150);
    expect(r.profile("f39", now).slpm).toBeGreaterThan(r.profile("f0", now).slpm);
  });
  it("produces corner-symmetric features", () => {
    const { fighters, bouts } = league(20, 300);
    const r = new UfcReplay(fighters, bouts);
    for (const b of bouts) r.update(b);
    const d = new Date(Date.UTC(2030, 0, 1));
    const ab = r.features("f3", "f15", d, "Lightweight").x;
    const ba = r.features("f15", "f3", d, "Lightweight").x;
    ab.forEach((v, j) => expect(v).toBeCloseTo(-ba[j], 9));
  });
  it("fits a model that predicts held-out bouts better than a coin flip", () => {
    const { fighters, bouts } = league();
    const r = new UfcReplay(fighters, bouts);
    const rows: { x: number[]; y: 0 | 1 }[] = [];
    for (const b of bouts) {
      rows.push({ x: r.features(b.red, b.blue, b.date, b.weightClass).x, y: b.winner === b.red ? 1 : 0 });
      r.update(b);
    }
    const train = rows.slice(0, 1100);
    const test = rows.slice(1100);
    const fit = fitLogistic(train.map((t) => t.x), train.map((t) => t.y), 1);
    const late = new Date(Date.UTC(2030, 0, 1));
    expect(predictLogistic(fit.coefficients, r.features("f39", "f0", late, "Lightweight").x)).toBeGreaterThan(0.7);
    let ll = 0;
    for (const t of test) {
      const p = predictLogistic(fit.coefficients, t.x);
      ll -= t.y ? Math.log(p) : Math.log(1 - p);
    }
    expect(ll / test.length).toBeLessThan(0.66);
  });
});

describe("helpers", () => {
  it("reads fight time and weight classes", () => {
    expect(fightSeconds(2, "3:21")).toBe(300 + 201);
    expect(fightSeconds(null, null)).toBeNull();
    expect(weightClassLbs("Light Heavyweight")).toBe(205);
    expect(weightClassLbs("Lightweight")).toBe(155);
    expect(weightClassLbs("Women's Strawweight")).toBe(115);
    expect(weightClassLbs("Catch Weight")).toBeNull();
  });
});

describe("dedupeBouts", () => {
  const stats = { sigLanded: 10, sigAttempted: 20, tdLanded: 0, tdAttempted: 0, knockdowns: 0, subAttempts: 0, controlSeconds: 0 };
  const bout = (id: string, day: string, red: string, blue: string, withStats: boolean): BoutRecord => ({
    id, date: new Date(`${day}T03:00:00Z`), weightClass: "Lightweight", red, blue, winner: red, method: "Decision", seconds: 900,
    redStats: withStats ? stats : null, blueStats: withStats ? stats : null,
  });
  const now = new Date("2026-10-30T00:00:00Z");

  it("keeps one record per fight, preferring the copy with stats, whichever corner is which", () => {
    const out = dedupeBouts([bout("cito", "2025-03-28", "a", "b", false), bout("archive", "2025-03-29", "b", "a", true), bout("other", "2025-03-29", "c", "d", true)], now);
    expect(out.map((b) => b.id)).toEqual(["archive", "other"]);
  });

  it("catches a copy dated a year late by its identical finish", () => {
    const late = { ...bout("cito", "2025-11-15", "a", "b", false), seconds: 754 };
    const real = { ...bout("archive", "2024-11-16", "a", "b", true), seconds: 754 };
    expect(dedupeBouts([real, late], now).map((b) => b.id)).toEqual(["archive"]);
  });

  it("keeps a real rematch and drops results dated in the future", () => {
    const out = dedupeBouts([bout("first", "2024-01-10", "a", "b", true), bout("rematch", "2025-02-01", "a", "b", true), bout("future", "2027-01-05", "c", "d", true)], now);
    expect(out.map((b) => b.id)).toEqual(["first", "rematch"]);
  });
});
