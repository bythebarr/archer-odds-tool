import { describe, it, expect } from "vitest";
import { NFL_TEAMS, lookupNflTeam } from "./teams";

describe("NFL team allowlist", () => {
  it("has all 32 teams, 16 per conference, 4 per division", () => {
    expect(NFL_TEAMS).toHaveLength(32);
    expect(NFL_TEAMS.filter((t) => t.conference === "AFC")).toHaveLength(16);
    expect(NFL_TEAMS.filter((t) => t.conference === "NFC")).toHaveLength(16);

    const byDivision = new Map<string, number>();
    for (const t of NFL_TEAMS) {
      const key = `${t.conference} ${t.division}`;
      byDivision.set(key, (byDivision.get(key) ?? 0) + 1);
    }
    expect(byDivision.size).toBe(8);
    for (const [division, count] of byDivision) {
      expect(`${division}: ${count}`).toBe(`${division}: 4`);
    }
  });

  it("uses unique names and abbreviations", () => {
    expect(new Set(NFL_TEAMS.map((t) => t.name)).size).toBe(32);
    expect(new Set(NFL_TEAMS.map((t) => t.abbreviation)).size).toBe(32);
  });
});

describe("lookupNflTeam — the CFL filter", () => {
  it("resolves a team by its exact feed name", () => {
    expect(lookupNflTeam("Kansas City Chiefs")?.abbreviation).toBe("KC");
    expect(lookupNflTeam("San Francisco 49ers")?.abbreviation).toBe("SF");
  });

  it("REJECTS CFL clubs that the NFL sport key actually returns", () => {
    // Measured live 2026-07-21: ParlayAPI served all of these under
    // americanfootball_nfl. Storing them as NFL is the bug this prevents.
    for (const cfl of [
      "Edmonton Elks",
      "Saskatchewan Roughriders",
      "Calgary Stampeders",
      "Winnipeg Blue Bombers",
      "Toronto Argonauts",
      "BC Lions",
      "Hamilton Tiger-Cats",
      "Montreal Alouettes",
    ]) {
      expect(lookupNflTeam(cfl), cfl).toBeNull();
    }
  });

  it("tolerates cosmetic name drift, which this provider is known for", () => {
    expect(lookupNflTeam("kansas city chiefs")?.abbreviation).toBe("KC");
    expect(lookupNflTeam("  Kansas City   Chiefs  ")?.abbreviation).toBe("KC");
    expect(lookupNflTeam("San Francisco 49Ers")?.abbreviation).toBe("SF");
  });

  it("does NOT fuzzy-match a different team", () => {
    // A wrong match silently misattributes prices; a miss is merely reported.
    expect(lookupNflTeam("New York")).toBeNull();
    expect(lookupNflTeam("Los Angeles")).toBeNull();
  });

  it("keeps the two Cardinals/Giants name collisions distinct from MLB", () => {
    // Team rows are keyed by oddsApiName across sports, which is only safe
    // because full names differ. Guard that assumption.
    expect(lookupNflTeam("Arizona Cardinals")?.abbreviation).toBe("ARI");
    expect(lookupNflTeam("St. Louis Cardinals")).toBeNull();
    expect(lookupNflTeam("New York Giants")?.abbreviation).toBe("NYG");
    expect(lookupNflTeam("San Francisco Giants")).toBeNull();
  });
});
