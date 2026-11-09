import { describe, expect, it } from "vitest";
import { nflProbOver, projectNflProp } from "./projection";
import { NFL_PROP_STAT_BY_KEY } from "./propStats";
import { summarizeNflProp, type NflLogPoint } from "./propsMath";
import type { NflDefenseTable } from "./matchup";

const stat = (k: Parameters<typeof NFL_PROP_STAT_BY_KEY.get>[0]) => NFL_PROP_STAT_BY_KEY.get(k)!;
const zero = { passAttempts: 0, passCompletions: 0, passYards: 0, passTds: 0, interceptions: 0, rushAttempts: 0, rushYards: 0, rushTds: 0, receptions: 0, targets: 0, recYards: 0, recTds: 0, rushLongest: null, recLongest: null, fieldGoalsMade: null, extraPointsMade: null, kickingPoints: null, tackles: null, soloTackles: null, sacks: null };
const log = (o: Partial<NflLogPoint>, i = 0): NflLogPoint => ({ date: `2026-10-${String(25 - i).padStart(2, "0")}`, opponent: "BUF", isHome: true, season: 2026, ...zero, ...o });
const wr = (yards: number[], tds: number[] = []) => yards.map((y, i) => log({ receptions: Math.round(y / 12), recYards: y, recTds: tds[i] ?? 0 }, i));

const pos = (recYards: number) => ({ games: 8, allowed: { ...zero, recYards } });
const defense: NflDefenseTable = {
  season: 2026,
  fromLastSeason: false,
  teams: { SOFT: { games: 8, byPosition: { WR: pos(190) } }, MID: { games: 8, byPosition: { WR: pos(160) } }, HARD: { games: 8, byPosition: { WR: pos(130) } } },
};
const ctx = (opponent: string | null) => ({ defense, opponent, position: "WR" as const });

describe("projectNflProp", () => {
  it("needs three games", () => {
    expect(projectNflProp(wr([80, 90]), stat("recYards"), ctx(null))).toBeNull();
  });

  it("projects near recent form and moves with the matchup", () => {
    const logs = wr([90, 70, 85, 75, 80, 80]);
    const mid = projectNflProp(logs, stat("recYards"), ctx("MID"))!;
    expect(mid.mean).toBeGreaterThan(75);
    expect(mid.mean).toBeLessThan(85);
    expect(projectNflProp(logs, stat("recYards"), ctx("SOFT"))!.mean).toBeGreaterThan(projectNflProp(logs, stat("recYards"), ctx("HARD"))!.mean);
  });

  it("keeps a yards spread wide enough for football", () => {
    const p = projectNflProp(wr([80, 80, 80, 80]), stat("recYards"), ctx(null))!;
    expect(p.sd).toBeGreaterThanOrEqual(80 * 0.35 - 1e-9);
  });
});

describe("nflProbOver", () => {
  const logs = wr([90, 70, 85, 75, 80, 80], [1, 0, 1, 0, 0, 1]);
  it("falls as the yards line rises", () => {
    const p = projectNflProp(logs, stat("recYards"), ctx(null))!;
    expect(nflProbOver(p, stat("recYards"), 60.5)).toBeGreaterThan(nflProbOver(p, stat("recYards"), 80.5));
    expect(nflProbOver(p, stat("recYards"), 80.5)).toBeGreaterThan(nflProbOver(p, stat("recYards"), 100.5));
  });
  it("prices anytime TD from the TD rate", () => {
    const p = projectNflProp(logs, stat("anytimeTd"), ctx(null))!;
    const prob = nflProbOver(p, stat("anytimeTd"), 0.5);
    expect(prob).toBeGreaterThan(0.3);
    expect(prob).toBeLessThan(0.6);
  });
});

describe("summarizeNflProp", () => {
  it("rates hit windows, value and model at the consensus line", () => {
    const quotes = ["draftkings", "fanduel", "betmgm", "caesars"].flatMap((b, i) => [
      { bookKey: b, bookName: b, side: "over" as const, point: 74.5, priceAmerican: i === 0 ? 105 : -115 },
      { bookKey: b, bookName: b, side: "under" as const, point: 74.5, priceAmerican: i === 0 ? -125 : -105 },
    ]);
    const s = summarizeNflProp({ playerId: "p", stat: "recYards", quotes }, wr([90, 70, 85, 75, 80, 80]), stat("recYards"), "over", {
      season: 2026,
      venue: "home",
      opponent: "BUF",
      projection: ctx("MID"),
    })!;
    expect(s.point).toBe(74.5);
    expect(s.l5).toMatchObject({ hits: 4, sampleSize: 5 });
    expect(s.over).toMatchObject({ bookKey: "draftkings", priceAmerican: 105 });
    expect(s.value.over!.ev).toBeGreaterThan(0);
    expect(s.model).not.toBeNull();
    expect(s.splits.find((x) => x.key === "h2h")!.label).toBe("vs BUF");
  });
});

describe("packNflLog / unpackNflLog", () => {
  it("round-trips", async () => {
    const { packNflLog, unpackNflLog } = await import("./propsMath");
    const { emptyNflExtras } = await import("./propsMath");
    const l = { ...log({ passYards: 288, passTds: 2, rushYards: 14, opponent: "KC", isHome: false, season: 2025 }), ...emptyNflExtras(), rzTargets: 2, targetShare: 0.284 };
    expect(unpackNflLog(packNflLog(l))).toEqual(l);
  });
});

describe("absenceAdjustedLines", () => {
  it("passes lines through untouched without impacts or a side", async () => {
    const { absenceAdjustedLines } = await import("./projection");
    const lines = { homeSpread: -3, total: 44 };
    expect(absenceAdjustedLines(lines, true, 0, 0)).toBe(lines);
    expect(absenceAdjustedLines(lines, null, 3, 0)).toBe(lines);
    expect(absenceAdjustedLines({ homeSpread: null, total: null }, true, 3, 0)).toEqual({ homeSpread: null, total: null });
  });

  it("an opposing QB out makes the home side a bigger favorite and trims the total", async () => {
    const { absenceAdjustedLines } = await import("./projection");
    // Opponent loses 3 points of impact: our scoring +0.4×3, theirs −0.6×3.
    const adj = absenceAdjustedLines({ homeSpread: 3, total: 44 }, true, 0, 3);
    expect(adj.total).toBeCloseTo(44 - 0.6, 6);
    expect(adj.homeSpread).toBeCloseTo(0, 6);
  });

  it("our own QB out moves the same game the other way", async () => {
    const { absenceAdjustedLines } = await import("./projection");
    const adj = absenceAdjustedLines({ homeSpread: 3, total: 44 }, true, 3, 0);
    expect(adj.total).toBeCloseTo(44 - 0.6, 6);
    expect(adj.homeSpread).toBeCloseTo(6, 6);
  });

  it("reads from the away side symmetrically", async () => {
    const { absenceAdjustedLines } = await import("./projection");
    // We're away; the HOME team's QB (impact 3) is out: home spread should rise toward us by 3.
    const adj = absenceAdjustedLines({ homeSpread: -3, total: 44 }, false, 0, 3);
    expect(adj.homeSpread).toBeCloseTo(0, 6);
    expect(adj.total).toBeCloseTo(44 - 0.6, 6);
  });
});

describe("projectNflProp opponent absences", () => {
  const rb = (yards: number[]) => yards.map((y, i) => log({ rushAttempts: 15, rushYards: y }, i));
  const rbCtx = { defense, opponent: null, position: "RB" as const, lines: { homeSpread: 3, total: 44 }, isHome: true, baselinePoints: 22 };

  it("an opposing QB out lifts a back's rushing mean through the script", () => {
    const whole = projectNflProp(rb([60, 70, 65, 75, 68, 72]), stat("rushYards"), rbCtx)!;
    const qbOut = projectNflProp(rb([60, 70, 65, 75, 68, 72]), stat("rushYards"), { ...rbCtx, opponentAbsenceImpact: 3 })!;
    expect(whole.absenceImpact).toBeNull();
    expect(qbOut.absenceImpact).toEqual({ own: 0, opponent: 3 });
    expect(qbOut.mean).toBeGreaterThan(whole.mean);
    expect(qbOut.env.spread).toBeCloseTo(0, 6);
  });

  it("our own QB out does the reverse", () => {
    const whole = projectNflProp(rb([60, 70, 65, 75, 68, 72]), stat("rushYards"), rbCtx)!;
    const qbOut = projectNflProp(rb([60, 70, 65, 75, 68, 72]), stat("rushYards"), { ...rbCtx, ownAbsenceImpact: 3 })!;
    expect(qbOut.mean).toBeLessThan(whole.mean);
    expect(qbOut.env.spread).toBeCloseTo(6, 6);
  });
});
