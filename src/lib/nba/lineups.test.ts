import { describe, expect, it } from "vitest";
import { normalizeName, parseLineups, starterTonight } from "./lineups";

const feed = (status: string) => ({
  games: [
    {
      homeTeam: {
        teamAbbreviation: "DET",
        players: [
          { playerName: "Cade Cunningham", lineupStatus: status, rosterStatus: "Active" },
          { playerName: "Jaren Jackson Jr.", lineupStatus: status, rosterStatus: "Active" },
          { playerName: "Nikola Jokić", lineupStatus: status, rosterStatus: "Active" },
          { playerName: "Ausar Thompson", lineupStatus: status, rosterStatus: "Active" },
          { playerName: "Paul Reed", lineupStatus: status, rosterStatus: "Active" },
        ],
      },
      awayTeam: { teamAbbreviation: "PHI", players: [] },
    },
  ],
});

describe("lineups", () => {
  it("normalizes names across feeds", () => {
    expect(normalizeName("Jaren Jackson Jr.")).toBe(normalizeName("Jaren Jackson"));
    expect(normalizeName("Nikola Jokić")).toBe("nikola jokic");
    expect(normalizeName("De'Aaron Fox")).toBe("deaaron fox");
  });

  it("reads each team's five and whether they're confirmed", () => {
    expect(parseLineups(feed("Expected")).DET).toMatchObject({ status: "expected" });
    expect(parseLineups(feed("Confirmed")).DET.starters).toHaveLength(5);
    expect(parseLineups(feed("Confirmed")).PHI).toBeUndefined();
    expect(parseLineups(null)).toEqual({});
  });

  it("gives a role only from a confirmed lineup", () => {
    const confirmed = parseLineups(feed("Confirmed"));
    expect(starterTonight(confirmed, "DET", "Jaren Jackson")).toBe(true);
    expect(starterTonight(confirmed, "DET", "Jalen Duren")).toBe(false);
    expect(starterTonight(parseLineups(feed("Expected")), "DET", "Cade Cunningham")).toBeUndefined();
    expect(starterTonight(confirmed, "PHI", "Joel Embiid")).toBeUndefined();
  });
});
