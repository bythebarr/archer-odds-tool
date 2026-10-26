import { describe, expect, it } from "vitest";
import { parseNflBoxScore } from "./espnBoxScore";

const PASS_KEYS = ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions", "sacks-sackYardsLost", "adjQBR", "QBRating"];
const RUSH_KEYS = ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"];
const REC_KEYS = ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception", "receivingTargets"];

const payload = {
  boxscore: {
    players: [
      {
        team: { displayName: "Kansas City Chiefs" },
        statistics: [
          { name: "passing", keys: PASS_KEYS, athletes: [{ athlete: { id: "1", displayName: "Patrick Mahomes", position: { abbreviation: "QB" } }, stats: ["24/35", "291", "8.3", "2", "1", "2-14", "71.2", "98.4"] }] },
          {
            name: "rushing",
            keys: RUSH_KEYS,
            athletes: [
              { athlete: { id: "1", displayName: "Patrick Mahomes" }, stats: ["5", "31", "6.2", "0", "14"] },
              { athlete: { id: "2", displayName: "Isiah Pacheco" }, stats: ["17", "88", "5.2", "1", "21"] },
            ],
          },
          { name: "receiving", keys: REC_KEYS, athletes: [{ athlete: { id: "3", displayName: "Travis Kelce" }, stats: ["8", "94", "11.8", "1", "27", "11"] }] },
          { name: "defensive", keys: ["totalTackles"], athletes: [{ athlete: { id: "9", displayName: "Nick Bolton" }, stats: ["9"] }] },
        ],
      },
    ],
  },
};

describe("parseNflBoxScore", () => {
  const { lines } = parseNflBoxScore(payload);
  const by = (id: string) => lines.find((l) => l.espnAthleteId === id)!;

  it("merges a player's categories into one line", () => {
    expect(by("1")).toMatchObject({ position: "QB", passCompletions: 24, passAttempts: 35, passYards: 291, passTds: 2, interceptions: 1, rushAttempts: 5, rushYards: 31 });
  });

  it("reads rushing and receiving", () => {
    expect(by("2")).toMatchObject({ rushAttempts: 17, rushYards: 88, rushTds: 1 });
    expect(by("3")).toMatchObject({ receptions: 8, recYards: 94, recTds: 1, targets: 11 });
  });

  it("skips non-prop categories", () => {
    expect(lines.find((l) => l.espnAthleteId === "9")).toBeUndefined();
  });

  it("rejects a table missing its yards column", () => {
    const bad = { boxscore: { players: [{ team: { displayName: "X" }, statistics: [{ name: "rushing", keys: ["rushingAttempts"], athletes: [] }] }] } };
    expect(parseNflBoxScore(bad).rejected).toEqual(["X rushing"]);
  });
});
