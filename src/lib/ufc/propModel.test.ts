import { describe, expect, it } from "vitest";
import { fightLength, projectUfcProp, ufcCareerNumbers, ufcPropLine, ufcPropOver, ufcRates, type DivisionPrior, type UfcFightLog, type UfcLogLine } from "./propModel";

const prior: DivisionPrior = { sig: 4, td: 0.1, kd: 0.02, finish: 0.5 };
const line = (o: Partial<UfcLogLine> = {}): UfcLogLine => ({ sig: 60, sigAtt: 120, td: 2, tdAtt: 4, kd: 0, sub: 0, ctrl: 120, head: 40, body: 12, leg: 8, distance: 50, clinch: 5, ground: 5, total: 80, ...o });
const fight = (date: string, o: Partial<UfcFightLog> = {}): UfcFightLog => ({ date, opponent: "X", opponentId: "x", result: "W", method: "Decision - Unanimous", round: 3, time: "5:00", seconds: 900, scheduledRounds: 3, weightClass: "Lightweight", mine: line(), theirs: line({ sig: 30 }), ...o });

describe("UFC props model", () => {
  it("starts a debut at his division's average", () => {
    const r = ufcRates([], new Date("2026-10-31"), prior);
    expect(r.sig).toBeCloseTo(4);
    expect(r.finish).toBeCloseTo(0.5);
    expect(r.minutes).toBe(0);
  });

  it("moves toward his own tape as minutes pile up, never past it", () => {
    // 90 landed in 15 minutes: 6 a minute against a division 4.
    const busy = (d: string) => fight(d, { mine: line({ sig: 90 }) });
    const one = ufcRates([busy("2026-06-01")], new Date("2026-10-31"), prior);
    const many = ufcRates(Array.from({ length: 8 }, (_, i) => busy(`2026-0${i + 1}-01`)), new Date("2026-10-31"), prior);
    expect(one.sig).toBeGreaterThan(4);
    expect(many.sig).toBeGreaterThan(one.sig);
    expect(many.sig).toBeLessThan(6);
    expect(many.sigAllowed).toBeLessThan(4);
  });

  it("ignores fights on or after the date", () => {
    expect(ufcRates([fight("2026-11-05")], new Date("2026-10-31"), prior).minutes).toBe(0);
  });

  it("spreads fight length: a decision runs the distance, finishes come early", () => {
    const len = fightLength(0.5, 3);
    expect(len.reduce((a, [, p]) => a + p, 0)).toBeCloseTo(1);
    expect(len.at(-1)).toEqual([15, 0.5]);
    const exp5 = fightLength(0.5, 5).reduce((a, [m, p]) => a + m * p, 0);
    expect(exp5).toBeGreaterThan(fightLength(0.5, 3).reduce((a, [m, p]) => a + m * p, 0));
  });

  it("prices a monotone ladder with ARCHR's line near even", () => {
    const me = ufcRates([fight("2026-06-01")], new Date("2026-10-31"), prior);
    const p = projectUfcProp("sigStrikes", me, ufcRates([], new Date("2026-10-31"), prior), prior, 3);
    const l = ufcPropLine(p);
    expect(Math.abs(ufcPropOver(p, l) - 0.5)).toBeLessThan(0.08);
    expect(ufcPropOver(p, l - 10)).toBeGreaterThan(ufcPropOver(p, l + 10));
  });

  it("summarises career numbers", () => {
    const c = ufcCareerNumbers([fight("2026-06-01"), fight("2026-01-01")]);
    expect(c.slpm).toBeCloseTo(4);
    expect(c.strAcc).toBeCloseTo(0.5);
    expect(c.strDef).toBeCloseTo(0.75);
    expect(c.td15).toBeCloseTo(2);
    expect(c.tdDef).toBeCloseTo(0.5);
    expect(c.head).toBeCloseTo(40 / 60);
  });
});
