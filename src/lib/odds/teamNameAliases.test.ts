import { describe, it, expect } from "vitest";
import { canonicalTeamName } from "./teamNameAliases";

describe("canonicalTeamName", () => {
  it("reconciles the Athletics, whose feed name still carries the old city", () => {
    // Live 2026-07-21: MLB Stats API says "Athletics", ParlayAPI says "Oakland
    // Athletics", so every A's game went unmatched and unpriced.
    expect(canonicalTeamName("Oakland Athletics")).toBe("Athletics");
    expect(canonicalTeamName("Las Vegas Athletics")).toBe("Athletics");
    expect(canonicalTeamName("Athletics")).toBe("Athletics");
  });

  it("tolerates cosmetic drift in the feed's spelling", () => {
    expect(canonicalTeamName("oakland athletics")).toBe("Athletics");
    expect(canonicalTeamName("  Oakland   Athletics ")).toBe("Athletics");
  });

  it("passes through any name it has no alias for", () => {
    expect(canonicalTeamName("New York Yankees")).toBe("New York Yankees");
    expect(canonicalTeamName("Cleveland Guardians")).toBe("Cleveland Guardians");
  });

  it("does not collapse distinct teams that merely share a word", () => {
    // Guard against anyone replacing the alias table with fuzzy matching: a
    // wrong match writes another game's prices onto a board.
    expect(canonicalTeamName("Chicago White Sox")).toBe("Chicago White Sox");
    expect(canonicalTeamName("Chicago Cubs")).toBe("Chicago Cubs");
    expect(canonicalTeamName("New York Mets")).not.toBe("New York Yankees");
  });
});
