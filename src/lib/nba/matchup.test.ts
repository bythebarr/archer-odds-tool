import { describe, expect, it } from "vitest";
import { matchupGrade, ordinal, paceRank, statMatchup, type DefenseTable } from "./matchup";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";

const line = (points: number, rebounds = 40, assists = 25) => ({ points, rebounds, assists, threesMade: 12, steals: 8, blocks: 5 });
const table: DefenseTable = {
  season: 2026,
  fromLastSeason: false,
  teams: {
    BOS: { games: 10, allowed: line(105), combinedPoints: 215 },
    NYK: { games: 10, allowed: line(112), combinedPoints: 224 },
    WAS: { games: 10, allowed: line(124, 48), combinedPoints: 240 },
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
