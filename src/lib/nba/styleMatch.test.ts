import { describe, expect, it } from "vitest";
import { similarOpponents, styleRecord } from "./styleMatch";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";
import type { DefenseTable, TeamDefenseRow } from "./matchup";
import type { GameLogPoint } from "./propsMath";

const points = NBA_PROP_STAT_BY_KEY.get("points")!;

const row = (pace: number, pts: number): TeamDefenseRow => ({
  games: 20,
  combinedPoints: pace,
  allowed: { points: pts, rebounds: 44, assists: 26, threesMade: 13, steals: 8, blocks: 5, turnovers: 14 },
  byPosition: {},
});

// Two styles: fast and leaky (F*), slow and stingy (S*).
const table: DefenseTable = {
  season: 2026,
  fromLastSeason: false,
  teams: {
    FA: row(240, 122), FB: row(238, 121), FC: row(241, 123), FD: row(239, 120), FE: row(242, 122), FF: row(237, 121),
    SA: row(212, 106), SB: row(214, 107), SC: row(211, 105), SD: row(213, 108), SE: row(215, 106), SF: row(210, 107),
  },
};

const log = (opponent: string, pts: number, i: number): GameLogPoint => ({
  date: new Date(Date.parse("2026-11-01T12:00:00Z") - i * 2 * 86_400_000).toISOString().slice(0, 10),
  opponent,
  isHome: true,
  season: 2026,
  minutes: 32,
  points: pts,
  rebounds: 5,
  assists: 4,
  threesMade: 2,
  steals: 1,
  blocks: 0,
  turnovers: 2,
});

describe("similarOpponents", () => {
  it("finds the teams that play like the opponent, not the opponent itself", () => {
    const like = similarOpponents(table, "FA", points);
    expect(like).toHaveLength(5);
    expect(like.every((t) => t.startsWith("F"))).toBe(true);
    expect(like).not.toContain("FA");
  });

  it("is empty for an unknown team", () => {
    expect(similarOpponents(table, "XYZ", points)).toEqual([]);
  });
});

describe("styleRecord", () => {
  // He scores 30 against fast teams and 15 against slow ones.
  const logs = ["FB", "SA", "FC", "SB", "FD", "SC", "FE", "SD", "FF", "SE"].map((t, i) => log(t, t.startsWith("F") ? 30 : 15, i));

  it("reads his record against the look-alikes", () => {
    const r = styleRecord(logs, table, "FA", points, null, "over", 22.5)!;
    expect(r.games).toBe(5);
    expect(r.hits).toBe(5);
    expect(r.avg).toBe(30);
    expect(r.overall).toBeCloseTo(22.5);
    expect(styleRecord(logs, table, "SA", points, null, "over", 22.5)!.hits).toBe(0);
  });

  it("needs enough games against them", () => {
    expect(styleRecord(logs.slice(0, 4), table, "FA", points, null, "over", 22.5)).toBeNull();
  });
});
