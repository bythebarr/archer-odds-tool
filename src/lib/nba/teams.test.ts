import { describe, it, expect } from "vitest";
import { NBA_TEAMS, lookupNbaTeam } from "./teams";

describe("NBA team allowlist", () => {
  it("has all 30 teams, 15 per conference, 5 per division", () => {
    expect(NBA_TEAMS).toHaveLength(30);
    expect(NBA_TEAMS.filter((t) => t.conference === "East")).toHaveLength(15);
    expect(NBA_TEAMS.filter((t) => t.conference === "West")).toHaveLength(15);

    const byDivision = new Map<string, number>();
    for (const t of NBA_TEAMS) byDivision.set(t.division, (byDivision.get(t.division) ?? 0) + 1);
    expect(byDivision.size).toBe(6);
    for (const [division, count] of byDivision) {
      expect(`${division}: ${count}`).toBe(`${division}: 5`);
    }
  });

  it("uses unique names and abbreviations", () => {
    expect(new Set(NBA_TEAMS.map((t) => t.name)).size).toBe(30);
    expect(new Set(NBA_TEAMS.map((t) => t.abbreviation)).size).toBe(30);
  });
});

describe("lookupNbaTeam", () => {
  it("resolves the books' name and tolerates cosmetic drift", () => {
    expect(lookupNbaTeam("Boston Celtics")?.abbreviation).toBe("BOS");
    expect(lookupNbaTeam("  boston   CELTICS ")?.abbreviation).toBe("BOS");
    expect(lookupNbaTeam("Philadelphia 76ers")?.abbreviation).toBe("PHI");
  });

  it("maps ESPN's 'LA Clippers' and the books' 'Los Angeles Clippers' to one team", () => {
    // The split that would leave every Clippers game priced but never graded.
    const books = lookupNbaTeam("Los Angeles Clippers");
    expect(books?.abbreviation).toBe("LAC");
    expect(lookupNbaTeam("LA Clippers")).toBe(books);
    // And the Lakers stay the Lakers — the alias must not bleed across LA teams.
    expect(lookupNbaTeam("Los Angeles Lakers")?.abbreviation).toBe("LAL");
  });

  it("rejects other leagues sharing the feed's sport key", () => {
    // WNBA clubs (same cities, different league) and an exhibition opponent.
    expect(lookupNbaTeam("Las Vegas Aces")).toBeNull();
    expect(lookupNbaTeam("Phoenix Mercury")).toBeNull();
    expect(lookupNbaTeam("New York Liberty")).toBeNull();
    expect(lookupNbaTeam("Real Madrid")).toBeNull();
  });

  it("does not match on a partial name", () => {
    expect(lookupNbaTeam("Lakers")).toBeNull();
    expect(lookupNbaTeam("Los Angeles")).toBeNull();
  });
});
