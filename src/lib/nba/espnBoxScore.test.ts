import { describe, it, expect } from "vitest";
import { parseNbaBoxScore } from "./espnBoxScore";

const KEYS = [
  "minutes",
  "points",
  "fieldGoalsMade-fieldGoalsAttempted",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted",
  "rebounds",
  "assists",
  "turnovers",
  "steals",
  "blocks",
];

function athlete(id: string, name: string, stats: string[], extra: Record<string, unknown> = {}) {
  return { athlete: { id, displayName: name, headshot: { href: `https://img/${id}.png` } }, starter: true, stats, ...extra };
}

function payload(teamName: string, table: Record<string, unknown>) {
  return { boxscore: { players: [{ team: { displayName: teamName }, statistics: [table] }] } };
}

describe("parseNbaBoxScore", () => {
  it("reads columns by key, not by position", () => {
    const { lines, rejectedTeams } = parseNbaBoxScore(
      payload("LA Clippers", {
        keys: KEYS,
        athletes: [athlete("1", "James Harden", ["36", "28", "9-19", "4-10", "6-6", "7", "11", "4", "2", "1"])],
      })
    );
    expect(rejectedTeams).toEqual([]);
    expect(lines).toEqual([
      {
        espnAthleteId: "1",
        name: "James Harden",
        headshotUrl: "https://img/1.png",
        teamName: "LA Clippers",
        starter: true,
        minutes: 36,
        points: 28,
        rebounds: 7,
        assists: 11,
        threesMade: 4,
        steals: 2,
        blocks: 1,
        turnovers: 4,
      },
    ]);
  });

  it("falls back to the abbreviation header and reads mm:ss minutes", () => {
    const { lines } = parseNbaBoxScore(
      payload("Boston Celtics", {
        names: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
        athletes: [athlete("2", "Jayson Tatum", ["38:12", "10-21", "3-9", "5-6", "1", "8", "9", "5", "1", "0", "3", "2", "+7", "28"])],
      })
    );
    expect(lines[0]).toMatchObject({ minutes: 38, points: 28, rebounds: 9, assists: 5, threesMade: 3, steals: 1, blocks: 0, turnovers: 3 });
  });

  it("skips players who didn't play — a voided prop is not a miss", () => {
    const { lines } = parseNbaBoxScore(
      payload("Boston Celtics", {
        keys: KEYS,
        athletes: [
          athlete("3", "DNP Guy", [], { didNotPlay: true }),
          athlete("4", "Zero Minutes", ["0", "0", "0-0", "0-0", "0-0", "0", "0", "0", "0", "0"]),
          athlete("5", "Played", ["12", "4", "2-3", "0-1", "0-0", "3", "1", "0", "0", "1"]),
        ],
      })
    );
    expect(lines.map((l) => l.name)).toEqual(["Played"]);
  });

  it("keeps a real zero stat rather than dropping it as falsy", () => {
    const { lines } = parseNbaBoxScore(
      payload("Boston Celtics", {
        keys: KEYS,
        athletes: [athlete("6", "Scoreless", ["9", "0", "0-4", "0-2", "0-0", "2", "0", "1", "0", "0"])],
      })
    );
    expect(lines[0]).toMatchObject({ points: 0, threesMade: 0, assists: 0 });
  });

  it("rejects a team block missing a needed column instead of guessing", () => {
    const { lines, rejectedTeams } = parseNbaBoxScore(
      payload("Boston Celtics", {
        keys: KEYS.filter((k) => k !== "rebounds"),
        athletes: [athlete("7", "Someone", ["30", "20", "8-15", "2-5", "2-2", "5", "1", "1", "0"])],
      })
    );
    expect(lines).toEqual([]);
    expect(rejectedTeams).toEqual(["Boston Celtics"]);
  });

  it("returns nothing for a null or empty payload", () => {
    expect(parseNbaBoxScore(null)).toEqual({ lines: [], rejectedTeams: [] });
    expect(parseNbaBoxScore({})).toEqual({ lines: [], rejectedTeams: [] });
  });
});
