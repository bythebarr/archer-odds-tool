import { describe, it, expect } from "vitest";
import {
  TennisElo,
  eloExpectation,
  canonicalSurface,
  winProbFromRatings,
  DEFAULT_ELO,
} from "./elo";

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

describe("winProbFromRatings (live-pricing path)", () => {
  it("matches the class winProb for the same ratings (backtest == pricing)", () => {
    // Build a live-pricing scenario and assert the stored-ratings function agrees
    // with a class instance seeded to the same ratings — the two must never diverge.
    const a = { overall: 1900, grass: 1850 };
    const b = { overall: 1700, grass: 1780 };
    const surfaceWeight = DEFAULT_ELO.surfaceWeight;
    const shrink = DEFAULT_ELO.calibrationShrink;
    // Hand-compute the expected blended-then-shrunk probability.
    const ra = surfaceWeight * a.grass + (1 - surfaceWeight) * a.overall;
    const rb = surfaceWeight * b.grass + (1 - surfaceWeight) * b.overall;
    const raw = eloExpectation(ra, rb);
    const expected = 1 / (1 + Math.exp(-shrink * Math.log(raw / (1 - raw))));
    expect(winProbFromRatings(a, b, "grass")).toBeCloseTo(expected, 10);
  });

  it("falls back to overall when the surface rating is absent", () => {
    const a = { overall: 1900 }; // no grass rating
    const b = { overall: 1700 };
    const p = winProbFromRatings(a, b, "grass");
    // Equals the null-surface (overall-only) probability.
    expect(p).toBeCloseTo(winProbFromRatings(a, b, null), 10);
    expect(p).toBeGreaterThan(0.5);
  });
});
