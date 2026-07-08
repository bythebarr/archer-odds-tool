import { describe, it, expect } from "vitest";
import { countryOfPlayer, flagEmoji } from "./nationality";

describe("flagEmoji", () => {
  it("converts alpha-2 codes to regional-indicator flags", () => {
    expect(flagEmoji("ES")).toBe("🇪🇸");
    expect(flagEmoji("US")).toBe("🇺🇸");
    expect(flagEmoji("it")).toBe("🇮🇹"); // case-insensitive
  });
  it("returns empty for malformed codes", () => {
    expect(flagEmoji("ESP")).toBe("");
    expect(flagEmoji("")).toBe("");
  });
});

describe("countryOfPlayer", () => {
  it("resolves known players by exact name", () => {
    expect(countryOfPlayer("Carlos Alcaraz")).toBe("ES");
    expect(countryOfPlayer("Taylor Fritz")).toBe("US");
    expect(countryOfPlayer("Alexander Bublik")).toBe("KZ");
    expect(countryOfPlayer("  Jannik Sinner ")).toBe("IT"); // trims
  });
  it("falls back to an unambiguous surname", () => {
    // "Sinner" is unique in the map → surname fallback resolves a name variant.
    expect(countryOfPlayer("J. Sinner")).toBe("IT");
  });
  it("returns null for unknown players", () => {
    expect(countryOfPlayer("Some Qualifier")).toBeNull();
  });
});
