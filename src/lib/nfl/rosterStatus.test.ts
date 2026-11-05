import { describe, expect, it } from "vitest";
import { nflPoolExclusion, parseNflDepth, parseNflRoster, type NflTeamStatus } from "./rosterStatus";

const roster = {
  team: { id: "6", abbreviation: "DAL" },
  athletes: [
    { position: "offense", items: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }] },
    { position: "defense", items: [{ id: "10" }] },
    { position: "injuredReserveOrOut", items: [{ id: "5" }] },
    { position: "practiceSquad", items: [{ id: "6" }] },
  ],
};

const ref = (id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/${id}?lang=en` });
const depth = {
  items: [
    {
      positions: {
        qb: { athletes: [{ rank: 1, athlete: ref("1") }, { rank: 2, athlete: ref("2") }] },
        wr: { athletes: [{ rank: 1, athlete: ref("3") }] },
      },
    },
    { positions: { h: { athletes: [{ rank: 1, athlete: ref("2") }] } } },
  ],
};

describe("parseNflRoster", () => {
  it("splits the active roster from IR and the practice squad", () => {
    const r = parseNflRoster(roster);
    expect(r.espnTeamId).toBe("6");
    expect([...r.active].sort()).toEqual(["1", "10", "2", "3", "4"]);
    expect(r.off.get("5")).toBe("Injured reserve");
    expect(r.off.get("6")).toBe("Practice squad");
  });
});

describe("parseNflDepth", () => {
  it("keeps a player's rank at each position", () => {
    const d = parseNflDepth(depth);
    expect(d.get("1")).toEqual({ qb: 1 });
    expect(d.get("2")).toEqual({ qb: 2, h: 1 });
  });
});

describe("nflPoolExclusion", () => {
  const status: NflTeamStatus = { ...parseNflRoster(roster), depth: parseNflDepth(depth) };
  const check = (espnId: string, position: string | null, bookListed: Set<string> | null = null) => nflPoolExclusion({ espnId, position, bookListed, status });

  it("keeps only the book's players once it has posted the game", () => {
    expect(check("2", "QB", new Set(["2"]))).toBeNull();
    expect(check("3", "WR", new Set(["2"]))).toMatch(/book/);
    // Listed by the book but on IR: still out.
    expect(check("5", "WR", new Set(["5"]))).toBe("Injured reserve");
  });

  it("drops IR, the practice squad and players off the roster", () => {
    expect(check("5", "WR")).toBe("Injured reserve");
    expect(check("6", "WR")).toBe("Practice squad");
    expect(check("99", "WR")).toMatch(/active roster/);
  });

  it("reads the depth chart: the starting QB only, and nobody off the chart", () => {
    expect(check("1", "QB")).toBeNull();
    expect(check("2", "QB")).toMatch(/QB2/);
    expect(check("3", "WR")).toBeNull();
    expect(check("4", "WR")).toMatch(/depth chart/);
  });

  it("lets everyone through when ESPN didn't answer", () => {
    expect(nflPoolExclusion({ espnId: "99", position: "QB", bookListed: null, status: null })).toBeNull();
  });
});
