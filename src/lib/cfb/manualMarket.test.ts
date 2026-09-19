import { describe, it, expect } from "vitest";
import {
  validateAmericanOdds,
  validateSpread,
  validateTotal,
  serializeStore,
  parseStore,
  getEntry,
  setEntry,
  clearEntry,
  compareToModel,
  type ManualMarketStore,
} from "./manualMarket";
import type { CfbGamePrediction, ManualMarketEntry } from "./types";

const PREDICTION: CfbGamePrediction = {
  projectedHomeScore: 30,
  projectedAwayScore: 24,
  projectedMargin: 6,
  projectedTotal: 54,
  homeWinProb: 0.68,
  awayWinProb: 0.32,
  confidence: "medium",
  drivers: { offenseEdge: 0, defenseEdge: 0, scheduleStrengthEdge: 0, homeFieldPoints: 2, minGamesPlayed: 5 },
};

describe("validateAmericanOdds", () => {
  it("accepts typical favorite and underdog prices", () => {
    expect(validateAmericanOdds(-150)).toBe(-150);
    expect(validateAmericanOdds(130)).toBe(130);
    expect(validateAmericanOdds("120")).toBe(120);
  });

  it("accepts the ±100 boundary", () => {
    expect(validateAmericanOdds(100)).toBe(100);
    expect(validateAmericanOdds(-100)).toBe(-100);
  });

  it("rejects values in the invalid (-100, 100) gap", () => {
    expect(validateAmericanOdds(50)).toBeNull();
    expect(validateAmericanOdds(-50)).toBeNull();
    expect(validateAmericanOdds(0)).toBeNull();
  });

  it("rejects non-numeric and non-integer input", () => {
    expect(validateAmericanOdds("abc")).toBeNull();
    expect(validateAmericanOdds(150.5)).toBeNull();
    expect(validateAmericanOdds(undefined)).toBeNull();
    expect(validateAmericanOdds(null)).toBeNull();
  });

  it("rejects NaN and Infinity explicitly", () => {
    expect(validateAmericanOdds(NaN)).toBeNull();
    expect(validateAmericanOdds(Infinity)).toBeNull();
    expect(validateAmericanOdds(-Infinity)).toBeNull();
    expect(validateAmericanOdds("Infinity")).toBeNull();
  });
});

describe("validateSpread / validateTotal", () => {
  it("accepts a normal spread and total", () => {
    expect(validateSpread(-3.5)).toBe(-3.5);
    expect(validateSpread(7)).toBe(7);
    expect(validateTotal(54.5)).toBe(54.5);
  });

  it("rejects an out-of-range or non-finite spread/total", () => {
    expect(validateSpread(150)).toBeNull();
    expect(validateSpread(NaN)).toBeNull();
    expect(validateSpread(Infinity)).toBeNull();
    expect(validateSpread(-Infinity)).toBeNull();
    expect(validateTotal(0)).toBeNull();
    expect(validateTotal(-10)).toBeNull();
    expect(validateTotal(500)).toBeNull();
    expect(validateTotal(NaN)).toBeNull();
    expect(validateTotal(Infinity)).toBeNull();
  });
});

describe("serializeStore / parseStore", () => {
  it("round-trips a store with no real browser/localStorage involved", () => {
    const store: ManualMarketStore = {
      "401869940": { homeSpread: -3.5, marketTotal: 54.5, homeMoneyline: -170, awayMoneyline: 145 },
    };
    const raw = serializeStore(store);
    expect(parseStore(raw)).toEqual(store);
  });

  it("returns an empty store for null, corrupt JSON, or a non-object payload", () => {
    expect(parseStore(null)).toEqual({});
    expect(parseStore("{not json")).toEqual({});
    expect(parseStore("42")).toEqual({});
    expect(parseStore('"a string"')).toEqual({});
  });

  it("sanitizes a corrupted entry rather than surfacing invalid data", () => {
    const raw = JSON.stringify({ "401869940": { homeSpread: "not a number", marketTotal: -5, homeMoneyline: 50, awayMoneyline: -170 } });
    expect(parseStore(raw)).toEqual({
      "401869940": { homeSpread: null, marketTotal: null, homeMoneyline: null, awayMoneyline: -170 },
    });
  });
});

describe("getEntry / setEntry / clearEntry", () => {
  it("returns the empty entry for a game with no manual lines yet", () => {
    const entry = getEntry({}, "401869940");
    expect(entry).toEqual({ homeSpread: null, marketTotal: null, homeMoneyline: null, awayMoneyline: null });
  });

  it("sets and clears one game's entry without disturbing others", () => {
    let store: ManualMarketStore = {};
    store = setEntry(store, "game1", { homeSpread: -3, marketTotal: 50, homeMoneyline: -140, awayMoneyline: 120 });
    store = setEntry(store, "game2", { homeSpread: 7, marketTotal: 44, homeMoneyline: -300, awayMoneyline: 250 });
    store = clearEntry(store, "game1");
    expect(getEntry(store, "game1")).toEqual({ homeSpread: null, marketTotal: null, homeMoneyline: null, awayMoneyline: null });
    expect(getEntry(store, "game2").homeSpread).toBe(7);
  });
});

describe("compareToModel", () => {
  const emptyEntry: ManualMarketEntry = { homeSpread: null, marketTotal: null, homeMoneyline: null, awayMoneyline: null };

  it("returns all-null diffs/probabilities when no manual lines are entered", () => {
    expect(compareToModel(emptyEntry, PREDICTION)).toEqual({
      spreadDiff: null,
      totalDiff: null,
      marketHomeWinProb: null,
      marketAwayWinProb: null,
      winProbDiff: null,
      homeCoverProb: null,
      awayCoverProb: null,
      overProb: null,
      underProb: null,
    });
  });

  it("computes spread and total diffs independently when only one is entered", () => {
    const entry: ManualMarketEntry = { ...emptyEntry, homeSpread: -3.5 };
    const cmp = compareToModel(entry, PREDICTION);
    expect(cmp.spreadDiff).toBeCloseTo(6 - 3.5, 9); // projectedMargin - (-homeSpread)
    expect(cmp.totalDiff).toBeNull();
    expect(cmp.marketHomeWinProb).toBeNull();
    expect(cmp.overProb).toBeNull(); // no market total entered — no fabricated probability
  });

  it("de-vigs both moneylines only when both sides are present, and diffs against the model", () => {
    const entry: ManualMarketEntry = { ...emptyEntry, homeMoneyline: -150, awayMoneyline: 130 };
    const cmp = compareToModel(entry, PREDICTION);
    expect(cmp.marketHomeWinProb).not.toBeNull();
    expect(cmp.marketAwayWinProb).not.toBeNull();
    expect(cmp.marketHomeWinProb! + cmp.marketAwayWinProb!).toBeCloseTo(1, 9);
    expect(cmp.winProbDiff).toBeCloseTo(PREDICTION.homeWinProb - cmp.marketHomeWinProb!, 9);
  });

  it("does not de-vig when only one moneyline side is present", () => {
    const entry: ManualMarketEntry = { ...emptyEntry, homeMoneyline: -150 };
    const cmp = compareToModel(entry, PREDICTION);
    expect(cmp.marketHomeWinProb).toBeNull();
    expect(cmp.winProbDiff).toBeNull();
  });

  it("computes a spread-cover probability only when a home spread is entered, summing to 1", () => {
    const entry: ManualMarketEntry = { ...emptyEntry, homeSpread: -3.5 };
    const cmp = compareToModel(entry, PREDICTION);
    expect(cmp.homeCoverProb).not.toBeNull();
    expect(cmp.awayCoverProb).not.toBeNull();
    expect(cmp.homeCoverProb! + cmp.awayCoverProb!).toBe(1);
    expect(cmp.homeCoverProb).toBeGreaterThan(0);
    expect(cmp.homeCoverProb).toBeLessThan(1);
  });

  it("favors the home side's cover probability when the model likes home more than the market spread does", () => {
    // PREDICTION.projectedMargin = 6. A generous home spread (home favored by only 1) should be easy to cover.
    const generous = compareToModel({ ...emptyEntry, homeSpread: -1 }, PREDICTION);
    // A stingy home spread (home favored by 10) should be hard to cover.
    const stingy = compareToModel({ ...emptyEntry, homeSpread: -10 }, PREDICTION);
    expect(generous.homeCoverProb!).toBeGreaterThan(stingy.homeCoverProb!);
  });

  it("computes an over/under probability only when a market total is entered, summing to 1", () => {
    const entry: ManualMarketEntry = { ...emptyEntry, marketTotal: 50 };
    const cmp = compareToModel(entry, PREDICTION);
    expect(cmp.overProb).not.toBeNull();
    expect(cmp.underProb).not.toBeNull();
    expect(cmp.overProb! + cmp.underProb!).toBe(1);
  });

  it("gives a higher over probability when the market total is well below the projection", () => {
    // PREDICTION.projectedTotal = 54.
    const low = compareToModel({ ...emptyEntry, marketTotal: 44 }, PREDICTION);
    const high = compareToModel({ ...emptyEntry, marketTotal: 64 }, PREDICTION);
    expect(low.overProb!).toBeGreaterThan(high.overProb!);
  });

  it("produces no cover/over-under probability for a missing spread or total (never fabricated)", () => {
    const cmp = compareToModel({ ...emptyEntry, homeMoneyline: -150, awayMoneyline: 130 }, PREDICTION);
    expect(cmp.homeCoverProb).toBeNull();
    expect(cmp.awayCoverProb).toBeNull();
    expect(cmp.overProb).toBeNull();
    expect(cmp.underProb).toBeNull();
  });

  it("gives an underdog a lower cover probability on a neutral-site (0 home-field) projection than a favorite", () => {
    const neutralPrediction: CfbGamePrediction = { ...PREDICTION, projectedMargin: 0, drivers: { ...PREDICTION.drivers, homeFieldPoints: 0 } };
    // A pick'em game (projected margin 0): home should need to cover a positive spread (favored) less than half the time.
    const cmp = compareToModel({ ...emptyEntry, homeSpread: -7 }, neutralPrediction);
    expect(cmp.homeCoverProb!).toBeLessThan(0.5);
  });
});
