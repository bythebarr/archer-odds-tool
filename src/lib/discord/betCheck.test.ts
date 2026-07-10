import { describe, it, expect } from "vitest";
import { verdictFor, parseAmericanPrice, teamMatches, matchGame, gradeBet, resolveSelection } from "./betCheck";
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

describe("gradeBet", () => {
  it("calls a price above fair value 'poor' and surfaces the fair price", () => {
    // Fair prob 0.60 → fair American ~-150. Getting -180 is worse than fair.
    const res = gradeBet("Yankees ML", -180, 0.6);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Poor value");
    expect(res.message).toContain("EV");
  });
  it("calls a price better than fair 'Good value'", () => {
    // Fair prob 0.60 → fair ~-150. Getting +120 is far better than fair.
    const res = gradeBet("Mets ML", 120, 0.6);
    expect(res.message).toContain("Good value");
  });
  it("appends a caveat note when provided", () => {
    expect(gradeBet("Over 8.5 (BOS/NYY)", -110, 0.52, "graded at main line").message).toContain("graded at main line");
  });
});

describe("resolveSelection", () => {
  // fairProbA = home/over, fairProbB = away/under; modalPoint is the HOME spread / the total.
  const consensus = { fairProbA: 0.62, fairProbB: 0.38, modalPoint: -1.5 };

  it("moneyline picks the matched side and labels it ML", () => {
    const r = resolveSelection({ market: "ml" }, "away", "Red Sox", "BOS/NYY", consensus);
    expect("fairProb" in r && r.fairProb).toBe(0.38);
    expect("selection" in r && r.selection).toBe("Red Sox ML");
  });

  it("spread flips the point sign for the away side", () => {
    const home = resolveSelection({ market: "spread" }, "home", "Yankees", "BOS/NYY", consensus);
    expect("selection" in home && home.selection).toBe("Yankees -1.5");
    const away = resolveSelection({ market: "spread" }, "away", "Red Sox", "BOS/NYY", consensus);
    expect("selection" in away && away.selection).toBe("Red Sox +1.5");
    expect("fairProb" in away && away.fairProb).toBe(0.38);
  });

  it("total requires a side, then maps over→A / under→B", () => {
    const totals = { fairProbA: 0.48, fairProbB: 0.52, modalPoint: 8.5 };
    expect(resolveSelection({ market: "total" }, "home", "x", "BOS/NYY", totals)).toHaveProperty("error");
    const over = resolveSelection({ market: "total", side: "over" }, "home", "x", "BOS/NYY", totals);
    expect("selection" in over && over.selection).toBe("Over 8.5 (BOS/NYY)");
    expect("fairProb" in over && over.fairProb).toBe(0.48);
  });

  it("flags an alt line different from the main line", () => {
    const r = resolveSelection({ market: "total", side: "over", line: "9.5" }, "home", "x", "BOS/NYY", { fairProbA: 0.5, fairProbB: 0.5, modalPoint: 8.5 });
    expect("note" in r && r.note).toContain("main line");
  });
});
