import { describe, expect, it } from "vitest";
import { matchupGrade, ordinal, paceRank, statMatchup, type DefenseTable } from "./matchup";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";

const line = (points: number, rebounds = 40, assists = 25) => ({ points, rebounds, assists, threesMade: 12, steals: 8, blocks: 5, turnovers: 0 });
const table: DefenseTable = {
  season: 2026,
  fromLastSeason: false,
  teams: {
    BOS: { games: 10, allowed: line(105), combinedPoints: 215, byPosition: {} },
    NYK: { games: 10, allowed: line(112), combinedPoints: 224, byPosition: {} },
    WAS: { games: 10, allowed: line(124, 48), combinedPoints: 240, byPosition: {} },
  },
};

describe("statMatchup", () => {
  it("ranks 1 as the team that gives up the most", () => {
    const pts = NBA_PROP_STAT_BY_KEY.get("points")!;
    expect(statMatchup(table, "WAS", pts)).toMatchObject({ perGame: 124, rank: 1, of: 3 });
    expect(statMatchup(table, "BOS", pts)).toMatchObject({ rank: 3 });
    expect(statMatchup(table, "XXX", pts)).toBeNull();
  });

  it("reads combo stats off the same averages", () => {
    const pr = NBA_PROP_STAT_BY_KEY.get("pointsRebounds")!;
    expect(statMatchup(table, "WAS", pr)?.perGame).toBe(172);
  });
});

describe("statMatchup by position", () => {
  const pos = (games: number, points: number) => ({ games, allowed: line(points, 10, 5) });
  const byPos: DefenseTable = {
    ...table,
    teams: {
      BOS: { ...table.teams.BOS, byPosition: { G: pos(8, 40), C: pos(8, 30) } },
      NYK: { ...table.teams.NYK, byPosition: { G: pos(8, 52), C: pos(8, 18) } },
      WAS: { ...table.teams.WAS, byPosition: { G: pos(3, 70), C: pos(3, 40) } },
    },
  };
  const pts = NBA_PROP_STAT_BY_KEY.get("points")!;

  it("ranks against what teams allow to that position", () => {
    expect(statMatchup(byPos, "NYK", pts, "G")).toMatchObject({ scope: "position", perGame: 52, rank: 1, of: 2 });
    expect(statMatchup(byPos, "NYK", pts, "C")).toMatchObject({ scope: "position", perGame: 18, rank: 2, of: 2 });
  });

  it("falls back to the team-wide read on a thin position sample", () => {
    expect(statMatchup(byPos, "WAS", pts, "G")).toMatchObject({ scope: "team", perGame: 124 });
    expect(statMatchup(byPos, "BOS", pts, "F")).toMatchObject({ scope: "team" });
    expect(statMatchup(byPos, "BOS", pts, null)).toMatchObject({ scope: "team" });
  });
});

describe("matchupGrade", () => {
  it("flips with the side", () => {
    expect(matchupGrade(1, 30, "over")).toBe("great");
    expect(matchupGrade(1, 30, "under")).toBe("bad");
    expect(matchupGrade(15, 30, "over")).toBe("neutral");
    expect(matchupGrade(30, 30, "under")).toBe("great");
  });
});

describe("paceRank / ordinal", () => {
  it("ranks the fastest games first", () => {
    expect(paceRank(table, "WAS")).toMatchObject({ rank: 1, of: 3 });
  });
  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "30th"]);
  });
});
