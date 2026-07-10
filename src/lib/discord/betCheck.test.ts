import { describe, it, expect } from "vitest";
import { verdictFor, parseAmericanPrice, teamMatches, matchGame, gradeMoneyline } from "./betCheck";
import type { GameWithLines } from "@/lib/queries/games";

describe("verdictFor", () => {
  it("bands EV into sharp / fair / poor", () => {
    expect(verdictFor(0.05)).toBe("sharp");
    expect(verdictFor(0.02)).toBe("sharp"); // boundary
    expect(verdictFor(0.0)).toBe("fair");
    expect(verdictFor(-0.019)).toBe("fair");
    expect(verdictFor(-0.02)).toBe("poor"); // boundary
    expect(verdictFor(-0.08)).toBe("poor");
  });
});

describe("parseAmericanPrice", () => {
  it("parses signed and bare prices", () => {
    expect(parseAmericanPrice("-120")).toBe(-120);
    expect(parseAmericanPrice("+105")).toBe(105);
    expect(parseAmericanPrice(" 120 ")).toBe(120);
  });
  it("rejects the invalid -99..99 gap and junk", () => {
    expect(parseAmericanPrice("50")).toBeNull();
    expect(parseAmericanPrice("-99")).toBeNull();
    expect(parseAmericanPrice("abc")).toBeNull();
    expect(parseAmericanPrice("")).toBeNull();
  });
});

describe("teamMatches", () => {
  const yankees = { name: "New York Yankees", abbreviation: "NYY" };
  it("matches by abbreviation, full name, word, or substring", () => {
    expect(teamMatches(yankees, "NYY")).toBe(true);
    expect(teamMatches(yankees, "yankees")).toBe(true);
    expect(teamMatches(yankees, "New York Yankees")).toBe(true);
    expect(teamMatches(yankees, "yank")).toBe(true); // substring
  });
  it("rejects non-matches", () => {
    expect(teamMatches(yankees, "red sox")).toBe(false);
    expect(teamMatches(yankees, "")).toBe(false);
  });
});

function gameWith(home: string, homeAbbr: string, away: string, awayAbbr: string): GameWithLines {
  return {
    game: {
      id: `${homeAbbr}-${awayAbbr}`,
      scheduledStartUtc: new Date("2026-07-10T23:00:00Z"),
      homeTeam: { id: "h", name: home, abbreviation: homeAbbr, mlbTeamId: 1 },
      awayTeam: { id: "a", name: away, abbreviation: awayAbbr, mlbTeamId: 2 },
    },
    lines: [],
  } as unknown as GameWithLines;
}

describe("matchGame", () => {
  const games = [
    gameWith("New York Yankees", "NYY", "Boston Red Sox", "BOS"),
    gameWith("New York Mets", "NYM", "Atlanta Braves", "ATL"),
  ];
  it("finds the single game + side for a specific query", () => {
    const r = matchGame(games, "red sox");
    expect("match" in r && r.match.side).toBe("away");
    expect("match" in r && r.match.teamName).toBe("Boston Red Sox");
  });
  it("flags an ambiguous query that hits two games", () => {
    expect(matchGame(games, "new york")).toEqual({ error: "ambiguous" });
  });
  it("reports no match", () => {
    expect(matchGame(games, "dodgers")).toEqual({ error: "none" });
  });
});

describe("gradeMoneyline", () => {
  it("calls a price above fair value 'poor' and surfaces the fair price", () => {
    // Fair prob 0.60 → fair American ~-150. Getting -180 is worse than fair.
    const res = gradeMoneyline("Yankees", -180, 0.6);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Poor value");
    expect(res.message).toContain("EV");
  });
  it("calls a price better than fair 'Good value'", () => {
    // Fair prob 0.60 → fair ~-150. Getting +120 is far better than fair.
    const res = gradeMoneyline("Mets", 120, 0.6);
    expect(res.message).toContain("Good value");
  });
});
