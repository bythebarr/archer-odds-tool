import { describe, it, expect } from "vitest";
import { createTeamLookup, normalizeTeamName } from "./league";

describe("normalizeTeamName", () => {
  it("ignores case, punctuation, and spacing", () => {
    expect(normalizeTeamName("  St. Louis   Blues ")).toBe("st louis blues");
  });
});

describe("createTeamLookup", () => {
  const teams = [
    { name: "Alpha City Owls", abbreviation: "ACO", conference: "A", division: "X", aliases: ["AC Owls"] },
    { name: "Beta Town Bears", abbreviation: "BTB", conference: "B", division: "Y" },
  ];

  it("resolves canonical names and aliases to the same team", () => {
    const lookup = createTeamLookup(teams);
    expect(lookup("Alpha City Owls")).toBe(teams[0]);
    expect(lookup("ac owls")).toBe(teams[0]);
    expect(lookup("Beta Town Bears")).toBe(teams[1]);
    expect(lookup("Gamma Gophers")).toBeNull();
  });

  it("refuses an allowlist where two teams claim one name", () => {
    // A silent last-write-wins here would route one team's prices to another.
    expect(() =>
      createTeamLookup([...teams, { name: "AC Owls", abbreviation: "X", conference: "A", division: "X" }])
    ).toThrow(/duplicate/);
  });
});
