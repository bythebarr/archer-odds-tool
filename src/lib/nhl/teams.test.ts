import { describe, it, expect } from "vitest";
import { NHL_TEAMS, lookupNhlTeam } from "./teams";

describe("NHL team allowlist", () => {
  it("has all 32 teams, 16 per conference, 8 per division", () => {
    expect(NHL_TEAMS).toHaveLength(32);
    expect(NHL_TEAMS.filter((t) => t.conference === "East")).toHaveLength(16);
    expect(NHL_TEAMS.filter((t) => t.conference === "West")).toHaveLength(16);

    // Four divisions (unlike the NFL's eight): Atlantic + Metropolitan in the
    // East, Central + Pacific in the West, eight clubs each — and no division
    // straddles conferences.
    const byDivision = new Map<string, { count: number; conferences: Set<string> }>();
    for (const t of NHL_TEAMS) {
      const entry = byDivision.get(t.division) ?? { count: 0, conferences: new Set<string>() };
      entry.count += 1;
      entry.conferences.add(t.conference);
      byDivision.set(t.division, entry);
    }
    expect(byDivision.size).toBe(4);
    for (const [division, { count, conferences }] of byDivision) {
      expect(`${division}: ${count}`).toBe(`${division}: 8`);
      expect(conferences.size).toBe(1);
    }
  });

  it("uses unique names and abbreviations", () => {
    expect(new Set(NHL_TEAMS.map((t) => t.name)).size).toBe(32);
    expect(new Set(NHL_TEAMS.map((t) => t.abbreviation)).size).toBe(32);
  });
});

describe("lookupNhlTeam", () => {
  it("resolves a team by its exact feed name", () => {
    expect(lookupNhlTeam("Philadelphia Flyers")?.abbreviation).toBe("PHI");
    expect(lookupNhlTeam("Vegas Golden Knights")?.abbreviation).toBe("VGK");
    expect(lookupNhlTeam("Tampa Bay Lightning")?.abbreviation).toBe("TB");
  });

  it("still resolves Utah's pre-rename name to the same club", () => {
    // Feeds lag the 2025–26 rename; both names must land on one team row.
    expect(lookupNhlTeam("Utah Mammoth")?.abbreviation).toBe("UTA");
    expect(lookupNhlTeam("Utah Hockey Club")?.abbreviation).toBe("UTA");
  });

  it("REJECTS non-NHL clubs that ride the hockey feeds", () => {
    // AHL affiliates, international sides and KHL clubs are not NHL teams:
    // storing one would allocate NHL prices to a club that never plays here.
    for (const other of ["Toronto Marlies", "Hershey Bears", "Team USA", "SKA Saint Petersburg", "Frölunda HC"]) {
      expect(lookupNhlTeam(other)).toBeNull();
    }
  });
});
