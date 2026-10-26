import { describe, expect, it } from "vitest";
import { nflProbOver, projectNflProp } from "./projection";
import { NFL_PROP_STAT_BY_KEY } from "./propStats";
import { summarizeNflProp, type NflLogPoint } from "./propsMath";
import type { NflDefenseTable } from "./matchup";

const stat = (k: Parameters<typeof NFL_PROP_STAT_BY_KEY.get>[0]) => NFL_PROP_STAT_BY_KEY.get(k)!;
const zero = { passAttempts: 0, passCompletions: 0, passYards: 0, passTds: 0, interceptions: 0, rushAttempts: 0, rushYards: 0, rushTds: 0, receptions: 0, targets: 0, recYards: 0, recTds: 0 };
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
    const l = log({ passYards: 288, passTds: 2, rushYards: 14, opponent: "KC", isHome: false, season: 2025 });
    expect(unpackNflLog(packNflLog(l))).toEqual(l);
  });
});
