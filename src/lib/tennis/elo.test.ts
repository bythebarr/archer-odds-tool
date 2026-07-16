import { describe, it, expect } from "vitest";
import { TennisElo, eloExpectation, canonicalSurface } from "./elo";

/**
 * Surface-aware Elo core (tennis Phase 4b). Pins the properties the model + its
 * calibration rest on: symmetric probabilities, ratings that move the right way,
 * K decay that stabilizes veterans, and genuine surface divergence.
 */

describe("canonicalSurface", () => {
  it("normalizes Sackmann case dupes", () => {
    expect(canonicalSurface("Clay")).toBe("clay");
    expect(canonicalSurface("clay")).toBe("clay");
    expect(canonicalSurface("Hard")).toBe("hard");
  });
  it("returns null for unknown/missing", () => {
    expect(canonicalSurface(null)).toBeNull();
    expect(canonicalSurface("")).toBeNull();
    expect(canonicalSurface("Ice")).toBeNull();
  });
});

describe("eloExpectation", () => {
  it("is 0.5 at equal ratings", () => {
    expect(eloExpectation(1500, 1500)).toBeCloseTo(0.5, 10);
  });
  it("a +400 gap is ~0.909", () => {
    expect(eloExpectation(1900, 1500)).toBeCloseTo(10 / 11, 6);
  });
});

describe("TennisElo", () => {
  it("two fresh players are a coin flip", () => {
    const elo = new TennisElo();
    expect(elo.winProb("a", "b", "hard")).toBeCloseTo(0.5, 10);
  });

  it("probabilities are symmetric", () => {
    const elo = new TennisElo();
    for (let i = 0; i < 20; i++) elo.update("a", "b", "hard");
    const p = elo.winProb("a", "b", "hard");
    const q = elo.winProb("b", "a", "hard");
    expect(p + q).toBeCloseTo(1, 10);
  });

  it("a winner's rating rises above the loser's", () => {
    const elo = new TennisElo();
    elo.update("winner", "loser", "hard");
    expect(elo.winProb("winner", "loser", "hard")).toBeGreaterThan(0.5);
    expect(elo.matchesPlayed("winner")).toBe(1);
  });

  it("K decays — a veteran's rating moves less per result than a rookie's", () => {
    const rookie = new TennisElo();
    const veteran = new TennisElo();
    // Give the veteran a long, even history so its overall match count is high but
    // its rating is back near base, then compare one more upset's impact.
    for (let i = 0; i < 100; i++) {
      veteran.update("vet", `opp${i}`, "hard");
      veteran.update(`opp${i}`, "vet", "hard"); // alternate so rating stays ~centered
    }
    const vetBefore = veteran.winProb("vet", "x", "hard");
    veteran.update("vet", "x", "hard");
    const vetDelta = veteran.winProb("vet", "x", "hard") - vetBefore;

    rookie.update("rook", "x", "hard");
    const rookDelta = rookie.winProb("rook", "x", "hard") - 0.5;

    expect(vetDelta).toBeGreaterThan(0);
    expect(vetDelta).toBeLessThan(rookDelta); // veteran moves less
  });

  it("surface awareness: beating a rival on clay but losing on grass diverges the surfaces", () => {
    const elo = new TennisElo();
    // Same two players; clayist owns clay, grasser owns grass. Overall stays ~even,
    // but the surface ratings should split clearly.
    for (let i = 0; i < 15; i++) {
      elo.update("clayist", "grasser", "clay");
      elo.update("grasser", "clayist", "grass");
    }
    expect(elo.blendedRating("clayist", "clay")).toBeGreaterThan(
      elo.blendedRating("clayist", "grass")
    );
    expect(elo.winProb("clayist", "grasser", "clay")).toBeGreaterThan(0.5);
    expect(elo.winProb("clayist", "grasser", "grass")).toBeLessThan(0.5);
  });

  it("off-surface (null) prediction uses overall only", () => {
    const elo = new TennisElo();
    elo.update("a", "b", "clay");
    // null surface → pure overall gap, independent of any surface rating
    const p = elo.winProb("a", "b", null);
    expect(p).toBeGreaterThan(0.5);
  });
});
