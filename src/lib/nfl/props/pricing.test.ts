import { describe, expect, it } from "vitest";
import { validatePredictionRunInput } from "@/lib/predictions";
import { loadFrozenModel, NFL_PROPS_MODEL_VERSION } from "./frozen";
import { buildNflPropsPredictionRun, MARKET_BY_KEY, PROP_MARKET_KEYS } from "./predictionCapture";
import { americanToDecimal, playerNameKey, priceProp, probToAmerican } from "./pricing";
import { PROP_MARKETS } from "./model";
import { poissonOver } from "./td";
import frozenV11 from "./frozen/nfl-props-v1.1.0.json";
import type { LiveProjection } from "./live";

describe("frozen model", () => {
  const model = loadFrozenModel();

  it("matches the code's declared version and covers every market", () => {
    expect(model.file.modelVersion).toBe(NFL_PROPS_MODEL_VERSION);
    for (const m of PROP_MARKETS) expect(model.file.distributions[m].bins.length).toBeGreaterThan(0);
  });

  it("P(over) falls as the line rises and rises with the projection", () => {
    expect(model.pOver("receivingYards", 70, 40.5)).toBeGreaterThan(model.pOver("receivingYards", 70, 90.5));
    expect(model.pOver("rushingYards", 90, 60.5)).toBeGreaterThan(model.pOver("rushingYards", 50, 60.5));
  });
});

describe("priceProp", () => {
  const model = loadFrozenModel();

  it("prices both sides, de-vigs the market, and computes EV", () => {
    const p = priceProp(model, 80, { market: "receivingYards", line: 60.5, overAmerican: -110, underAmerican: -110 });
    expect(p.pOver + p.pUnder).toBeCloseTo(1, 12);
    expect(p.marketPOver).toBeCloseTo(0.5, 12);
    expect(p.evOver).toBeCloseTo(p.pOver * americanToDecimal(-110) - 1, 12);
  });

  it("leaves market fields null when prices are missing", () => {
    const p = priceProp(model, 80, { market: "receivingYards", line: 60.5, overAmerican: null, underAmerican: null });
    expect(p.marketPOver).toBeNull();
    expect(p.evOver).toBeNull();
  });

  it("round-trips fair odds", () => {
    expect(probToAmerican(0.5)).toBe(-100);
    expect(probToAmerican(0.6)).toBe(-150);
    expect(probToAmerican(0.4)).toBe(150);
  });
});

describe("playerNameKey", () => {
  it("ignores case, punctuation, accents and suffixes", () => {
    expect(playerNameKey("Amon-Ra St. Brown")).toBe(playerNameKey("amonra st brown"));
    expect(playerNameKey("Kenneth Walker III")).toBe(playerNameKey("Kenneth Walker"));
    expect(playerNameKey("Ja'Marr Chase")).toBe(playerNameKey("JaMarr Chase"));
  });
});

describe("buildNflPropsPredictionRun", () => {
  const game = { gameId: "2026_03_SEA_WAS", espnId: "401872955", kickoffUtc: new Date("2026-09-27T17:00:00Z"), season: 2026, week: 3, home: "WAS", away: "SEA", spread: -7, total: 40.5 };
  const live: LiveProjection = {
    season: 2026,
    week: 3,
    games: [game],
    rows: [
      {
        game, playerId: "00-0038543", name: "Jaxon Smith-Njigba", position: "WR", headshotUrl: null, team: "SEA", opp: "WAS",
        market: "receivingYards", mean: 92.04, seasonAvg: 138.5, l5Avg: 105.8, priorGames: 53, injury: "Questionable", availabilityNote: null,
        breakdown: { teamVolume: 28.3, share: 0.344, efficiency: 9.26, oppFactor: 1.021, volumeLabel: "team targets", efficiencyLabel: "yards / target" },
      },
    ],
    excluded: [],
    dataAsOf: { lastCompletedWeek: "2026_02", statsThroughWeek: 2 },
    warnings: [],
  };

  it("builds a valid, experimental run keyed by ESPN event and GSIS id", () => {
    const run = buildNflPropsPredictionRun(live, loadFrozenModel().file, new Date("2026-09-25T12:00:00Z"));
    expect(validatePredictionRunInput(run)).toEqual([]);
    expect(run.lifecycle).toBe("experimental");
    const [p] = run.predictions;
    expect(p.eventRef).toBe("401872955");
    expect(p.marketKey).toBe(PROP_MARKET_KEYS.receivingYards);
    expect(MARKET_BY_KEY[p.marketKey]).toBe("receivingYards");
    expect(p.selectionKey).toBe("00-0038543");
    expect(p.probability).toBeNull();
    expect(p.missingInputs).toEqual({ injuryReport: "Questionable" });
  });
});

describe("touchdown markets (v1.2)", () => {
  it("poissonOver matches the closed form", () => {
    expect(poissonOver(0.5, 0.5)).toBeCloseTo(1 - Math.exp(-0.5), 12);
    expect(poissonOver(1.8, 1.5)).toBeCloseTo(1 - Math.exp(-1.8) * (1 + 1.8), 12);
    expect(poissonOver(1.8, 2.5)).toBeCloseTo(1 - Math.exp(-1.8) * (1 + 1.8 + 1.8 ** 2 / 2), 12);
  });

  it("the frozen model prices TD markets and they rise with the rate", () => {
    const model = loadFrozenModel();
    expect(model.file.td).toBeDefined();
    const lo = model.pOver("anytimeTd", 0.2, 0.5);
    const hi = model.pOver("anytimeTd", 0.8, 0.5);
    expect(hi).toBeGreaterThan(lo);
    expect(model.pOver("passingTds", 1.6, 1.5)).toBeGreaterThan(model.pOver("passingTds", 1.6, 2.5));
  });

  it("maps TD markets to stable prediction keys", () => {
    expect(PROP_MARKET_KEYS.anytimeTd).toBe("player_anytime_td");
    expect(MARKET_BY_KEY.player_passing_tds).toBe("passingTds");
  });

  it("v1.2.0 leaves every v1.1.0 number untouched", () => {
    const { td, modelVersion, frozenAt, ...rest } = loadFrozenModel().file;
    expect(td?.validation.length).toBe(4);
    expect(modelVersion).toBe("v1.2.0");
    expect(frozenAt).toBeTruthy();
    const v11 = { ...(frozenV11 as unknown as Record<string, unknown>) };
    delete v11.modelVersion;
    delete v11.frozenAt;
    expect(rest).toEqual(v11);
  });
});
