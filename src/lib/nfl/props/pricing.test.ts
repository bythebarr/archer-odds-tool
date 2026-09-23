import { describe, expect, it } from "vitest";
import { validatePredictionRunInput } from "@/lib/predictions";
import { loadFrozenModel, NFL_PROPS_MODEL_VERSION } from "./frozen";
import { buildNflPropsPredictionRun, MARKET_BY_KEY, PROP_MARKET_KEYS } from "./predictionCapture";
import { americanToDecimal, playerNameKey, priceProp, probToAmerican } from "./pricing";
import { PROP_MARKETS } from "./model";
import { poissonOver } from "./td";
import frozenV11 from "./frozen/nfl-props-v1.1.0.json";
import frozenV12 from "./frozen/nfl-props-v1.2.0.json";
import { intRate, oppIntFactor } from "./extras";
import type { Snapshot } from "./engine";
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

  it("each frozen version only adds to the previous one", () => {
    const strip = (f: object, ...keys: string[]) => {
      const o = { ...(f as Record<string, unknown>) };
      for (const k of ["modelVersion", "frozenAt", ...keys]) delete o[k];
      return o;
    };
    const current = loadFrozenModel().file;
    expect(current.modelVersion).toBe("v1.3.0");
    expect(current.td?.validation.length).toBe(4);
    expect(strip(current, "td", "extras")).toEqual(strip(frozenV11));
    expect(strip(current, "extras")).toEqual(strip(frozenV12));
  });
});

describe("v1.3 markets", () => {
  const model = loadFrozenModel();

  it("prices combos, interceptions and 2+ TDs monotonically", () => {
    expect(model.pOver("rushRecYards", 90, 60.5)).toBeGreaterThan(model.pOver("rushRecYards", 90, 110.5));
    expect(model.pOver("passRushYards", 260, 230.5)).toBeGreaterThan(model.pOver("passRushYards", 220, 230.5));
    expect(model.pOver("interceptions", 1.0, 0.5)).toBeGreaterThan(model.pOver("interceptions", 0.6, 0.5));
    // 2+ TDs always settles at 1.5 regardless of the line passed
    expect(model.pOver("twoPlusTds", 0.8, 0.5)).toBeCloseTo(model.pOver("twoPlusTds", 0.8, 1.5), 12);
    expect(model.pOver("twoPlusTds", 0.8, 1.5)).toBeLessThan(model.pOver("anytimeTd", 0.8, 0.5));
  });

  it("interception rate shrinks toward the league and scales with the defense", () => {
    const snap = (int: number, att: number, passInt: number, passAtt: number) =>
      ({ player: { int, att }, oppDef: { passInt, passAtt }, league: { intRate: 0.025 } }) as unknown as Snapshot;
    const p = { kInt: 400, kDefInt: 300, gammaInt: 0.5 };
    expect(intRate(snap(0, 0, 0, 0), p)).toBeCloseTo(0.025, 12);
    expect(intRate(snap(20, 400, 0, 0), p)).toBeCloseTo((20 + 400 * 0.025) / 800, 12);
    expect(oppIntFactor(snap(0, 0, 0, 0), p)).toBeCloseTo(1, 12);
    expect(oppIntFactor(snap(0, 0, 30, 600), p)).toBeGreaterThan(1);
  });

  it("maps the new markets to stable prediction keys", () => {
    expect(PROP_MARKET_KEYS.rushRecYards).toBe("player_rush_rec_yards");
    expect(MARKET_BY_KEY.player_interceptions).toBe("interceptions");
    expect(MARKET_BY_KEY.player_two_plus_tds).toBe("twoPlusTds");
  });
});
