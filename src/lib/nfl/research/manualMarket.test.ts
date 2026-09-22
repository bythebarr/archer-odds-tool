import { describe, it, expect } from "vitest";
import {
  validateAmericanOdds,
  validateSpread,
  parseStore,
  serializeStore,
  setEntry,
  getEntry,
  clearEntry,
  compareToModel,
  EMPTY_NFL_MANUAL_MARKET_ENTRY,
} from "./manualMarket";
import type { NflGamePrediction } from "./predictionCapture";

function prediction(overrides: Partial<NflGamePrediction> = {}): NflGamePrediction {
  return {
    homeWinProb: 0.6,
    awayWinProb: 0.4,
    expectedHomeMargin: 3,
    homeRating: 1550,
    awayRating: 1480,
    homeGamesPlayed: 10,
    awayGamesPlayed: 10,
    homeLowHistory: false,
    awayLowHistory: false,
    homeUnrated: false,
    awayUnrated: false,
    warnings: [],
    ...overrides,
  };
}

describe("validateAmericanOdds", () => {
  it("accepts a valid negative/positive line", () => {
    expect(validateAmericanOdds(-150)).toBe(-150);
    expect(validateAmericanOdds("130")).toBe(130);
  });
  it("rejects the impossible -100..100 open range", () => {
    expect(validateAmericanOdds(0)).toBeNull();
    expect(validateAmericanOdds(50)).toBeNull();
    expect(validateAmericanOdds(-50)).toBeNull();
  });
  it("rejects a non-integer or non-finite value", () => {
    expect(validateAmericanOdds(150.5)).toBeNull();
    expect(validateAmericanOdds(NaN)).toBeNull();
    expect(validateAmericanOdds("not a number")).toBeNull();
  });
});

describe("validateSpread", () => {
  it("preserves an absent line as null, never a fabricated 0", () => {
    expect(validateSpread(null)).toBeNull();
    expect(validateSpread(undefined)).toBeNull();
    expect(validateSpread("")).toBeNull();
  });
  it("accepts a real pick'em 0 spread", () => {
    expect(validateSpread(0)).toBe(0);
    expect(validateSpread("0")).toBe(0);
  });
  it("rejects an implausible NFL spread", () => {
    expect(validateSpread(75)).toBeNull();
    expect(validateSpread(-61)).toBeNull();
  });
  it("rejects a non-finite value", () => {
    expect(validateSpread(NaN)).toBeNull();
    expect(validateSpread(Infinity)).toBeNull();
  });
});

describe("store parse/serialize round-trip", () => {
  it("round-trips a valid entry", () => {
    const store = setEntry({}, "e1", { homeMoneyline: -150, awayMoneyline: 130, homeSpread: -3.5, awaySpread: 3.5, lineType: "current", source: "DK" }, new Date("2026-09-21T00:00:00Z"));
    const parsed = parseStore(serializeStore(store));
    expect(getEntry(parsed, "e1").homeMoneyline).toBe(-150);
    expect(getEntry(parsed, "e1").lineType).toBe("current");
    expect(getEntry(parsed, "e1").enteredAt).toBe("2026-09-21T00:00:00.000Z");
  });

  it("sanitizes an invalid persisted line back to null on read", () => {
    const raw = JSON.stringify({ e1: { homeMoneyline: 50, homeSpread: "not-a-number", lineType: "bogus", source: 123 } });
    const parsed = parseStore(raw);
    expect(getEntry(parsed, "e1").homeMoneyline).toBeNull(); // 50 is in the invalid range
    expect(getEntry(parsed, "e1").homeSpread).toBeNull();
    expect(getEntry(parsed, "e1").lineType).toBeNull();
    expect(getEntry(parsed, "e1").source).toBeNull();
  });

  it("tolerates corrupt JSON and a non-object shape", () => {
    expect(parseStore("{not json")).toEqual({});
    expect(parseStore("null")).toEqual({});
    expect(parseStore('"a string"')).toEqual({});
    expect(parseStore(null)).toEqual({});
  });

  it("getEntry falls back to the empty entry for an unknown game", () => {
    expect(getEntry({}, "missing")).toEqual(EMPTY_NFL_MANUAL_MARKET_ENTRY);
  });

  it("clearEntry removes only the targeted game", () => {
    let store = setEntry({}, "e1", { homeMoneyline: -150, awayMoneyline: null, homeSpread: null, awaySpread: null, lineType: null, source: null });
    store = setEntry(store, "e2", { homeMoneyline: 110, awayMoneyline: null, homeSpread: null, awaySpread: null, lineType: null, source: null });
    const cleared = clearEntry(store, "e1");
    expect(getEntry(cleared, "e1")).toEqual(EMPTY_NFL_MANUAL_MARKET_ENTRY);
    expect(getEntry(cleared, "e2").homeMoneyline).toBe(110);
  });

  it("setEntry always stamps enteredAt automatically, ignoring any caller-supplied value in the input type", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    const store = setEntry({}, "e1", { homeMoneyline: -110, awayMoneyline: null, homeSpread: null, awaySpread: null, lineType: null, source: null }, now);
    expect(getEntry(store, "e1").enteredAt).toBe(now.toISOString());
  });
});

describe("compareToModel — disagreement only, never a fabricated probability", () => {
  it("computes marginDiff only when a home spread is entered", () => {
    const entry = { ...EMPTY_NFL_MANUAL_MARKET_ENTRY, homeSpread: -3 };
    const cmp = compareToModel(entry, prediction({ expectedHomeMargin: 3 }));
    expect(cmp.marginDiff).toBe(0); // model margin 3, market implies home by 3 (-(-3))
  });

  it("returns null marginDiff when no spread is entered", () => {
    const cmp = compareToModel(EMPTY_NFL_MANUAL_MARKET_ENTRY, prediction());
    expect(cmp.marginDiff).toBeNull();
  });

  it("de-vigs and diffs win probability only when BOTH moneylines are entered", () => {
    const oneSided = { ...EMPTY_NFL_MANUAL_MARKET_ENTRY, homeMoneyline: -150 };
    expect(compareToModel(oneSided, prediction()).marketHomeWinProb).toBeNull();

    const both = { ...EMPTY_NFL_MANUAL_MARKET_ENTRY, homeMoneyline: -150, awayMoneyline: 130 };
    const cmp = compareToModel(both, prediction({ homeWinProb: 0.6 }));
    expect(cmp.marketHomeWinProb).not.toBeNull();
    expect(cmp.marketAwayWinProb).not.toBeNull();
    expect(cmp.winProbDiff).toBeCloseTo(0.6 - cmp.marketHomeWinProb!, 10);
  });

  it("never produces a cover probability or an over/under probability — no such field exists on the result type", () => {
    const entry = { ...EMPTY_NFL_MANUAL_MARKET_ENTRY, homeSpread: -3, homeMoneyline: -150, awayMoneyline: 130 };
    const cmp = compareToModel(entry, prediction());
    expect(Object.keys(cmp).sort()).toEqual(["marginDiff", "marketAwayWinProb", "marketHomeWinProb", "winProbDiff"]);
  });
});
