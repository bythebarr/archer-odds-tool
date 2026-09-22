import { describe, it, expect } from "vitest";
import { resolveNflTeamIdentity, observedNflverseCodes, validateNflverseCode } from "./teamIdentity";
import type { NflGame } from "../games";

/**
 * Explicit ESPN-to-nflverse team identity resolution. This is exactly the
 * spot the Rams' identity mismatch was found (nflverse uses "LA", not
 * "LAR") — see teamIdentity.ts's own docstring for how that was confirmed
 * against real nflverse data, not assumed.
 */

function game(home: string, away: string): NflGame {
  return {
    season: 2025,
    gameType: "REG",
    week: 1,
    date: new Date("2025-09-07T17:00:00.000Z"),
    away,
    home,
    result: 7,
    spreadLine: null,
    totalLine: null,
    homeMoneyline: null,
    awayMoneyline: null,
  };
}

describe("resolveNflTeamIdentity — exact mapping", () => {
  it("resolves a normal team to its display abbreviation and matching nflverse code", () => {
    const id = resolveNflTeamIdentity("Kansas City Chiefs");
    expect(id).toEqual({ espnName: "Kansas City Chiefs", abbreviation: "KC", nflverseCode: "KC" });
  });

  it("applies the Rams override: abbreviation LAR, nflverse code LA", () => {
    const id = resolveNflTeamIdentity("Los Angeles Rams");
    expect(id?.abbreviation).toBe("LAR");
    expect(id?.nflverseCode).toBe("LA");
  });

  it("returns null (never a guess) for an unknown/non-NFL name", () => {
    expect(resolveNflTeamIdentity("Toronto Argonauts")).toBeNull(); // CFL, per lookupNflTeam's own tests
    expect(resolveNflTeamIdentity("Some Random Team")).toBeNull();
  });

  it("does not fuzzy-match a partial name", () => {
    expect(resolveNflTeamIdentity("Los Angeles")).toBeNull();
    expect(resolveNflTeamIdentity("New York")).toBeNull();
  });

  it("tolerates only the same cosmetic drift lookupNflTeam already tolerates", () => {
    expect(resolveNflTeamIdentity("kansas city chiefs")?.abbreviation).toBe("KC");
  });
});

describe("observedNflverseCodes / validateNflverseCode", () => {
  it("collects every home/away code that appears in a fetched games array", () => {
    const codes = observedNflverseCodes([game("BUF", "KC"), game("SF", "SEA")]);
    expect(codes).toEqual(new Set(["BUF", "KC", "SF", "SEA"]));
  });

  it("validates a resolved identity whose code IS present", () => {
    const id = resolveNflTeamIdentity("Buffalo Bills")!;
    const observed = observedNflverseCodes([game("BUF", "KC")]);
    expect(validateNflverseCode(id, observed)).toBe(true);
  });

  it("rejects a resolved identity whose code is NOT present — the real Rams bug this module exists to prevent", () => {
    const id = resolveNflTeamIdentity("Los Angeles Rams")!; // nflverseCode: "LA"
    // A dataset that (hypothetically) only ever used "LAR", never "LA" —
    // simulating the exact silent-mismatch this module's override table fixes.
    const observedWrong = observedNflverseCodes([game("LAR", "KC")]);
    expect(validateNflverseCode(id, observedWrong)).toBe(false);
  });

  it("validates the Rams correctly against a realistic recent-season dataset (LA, not LAR)", () => {
    const id = resolveNflTeamIdentity("Los Angeles Rams")!;
    const observed = observedNflverseCodes([game("LA", "SEA"), game("SF", "LA")]);
    expect(validateNflverseCode(id, observed)).toBe(true);
  });

  it("does not treat a historical-only code (OAK/SD/STL) as validating a current team by coincidence", () => {
    // Raiders resolve to "LV"; a dataset containing only "OAK" must NOT validate them.
    const raiders = resolveNflTeamIdentity("Las Vegas Raiders")!;
    const observedOakOnly = observedNflverseCodes([game("OAK", "KC")]);
    expect(validateNflverseCode(raiders, observedOakOnly)).toBe(false);
  });
});
