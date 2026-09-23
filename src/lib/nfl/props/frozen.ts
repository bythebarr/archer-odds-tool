/**
 * The frozen, versioned NFL prop model — every fitted number the experiment
 * produced, written once by `NFL_PROPS_FREEZE=1 npm run experiment:nfl:props`
 * into `frozen/nfl-props-<version>.json` and never hand-edited. Everything the
 * app serves (projections, over/under probabilities) goes through this, so a
 * stored prediction is always reproducible from (version, inputs).
 *
 * Bump `NFL_PROPS_MODEL_VERSION` whenever a refit would change any number.
 */
import frozenJson from "./frozen/nfl-props-v1.4.0.json";
import { LogisticCalibrator, RatioDistribution, type FrozenRatioDistribution } from "./distribution";
import { MARKET_FAMILY, type PropFamily } from "./eligibility";
import type { EngineParams } from "./engine";
import { PROP_MARKETS, type ModelParams, type PropMarket } from "./model";
import { isTdMarket, poissonOver, type TdMarket, type TdParams } from "./td";
import { isExtraMarket, type ExtraMarket, type IntParams } from "./extras";
import { isBatchBMarket, pLongestOver, type BatchBMarket, type KickParams, type SurvivalCurve } from "./batchB";

/** Every market the app serves: yardage/volume (v1.0), touchdowns (v1.2), combos/INTs/2+ TDs (v1.3), longest/kickers/first TD (v1.4). */
export type ServedMarket = PropMarket | TdMarket | ExtraMarket | BatchBMarket;

/** Extra pricing inputs for markets one mean can't describe (longest plays): expected touches, yards per touch, position. */
export interface PricingAux {
  touches: number;
  ypp: number;
  position: string;
}

export const NFL_PROPS_SPORT_KEY = "nfl";
export const NFL_PROPS_MODEL_KEY = "nfl-props";
/**
 * v1.1.0 = v1.0.0 + carry-share redistribution when a teammate is ruled out.
 * v1.2.0 = v1.1.0 + touchdown markets (anytime TD, passing TDs).
 * v1.3.0 = v1.2.0 + rush+rec yards, pass+rush yards, interceptions, 2+ TDs.
 * v1.4.0 = v1.3.0 + longest reception/rush/completion, kicker FG made and
 * kicking points, first TD scorer.
 * Each version leaves every earlier number unchanged, and each addition passed
 * validation; see docs/architecture/NFL-PROPS-MODEL.md. Earlier frozen files
 * are kept for the record.
 */
export const NFL_PROPS_MODEL_VERSION = "v1.4.0";
export const NFL_PROPS_FEATURE_SCHEMA_VERSION = "nfl-props-features-v1";
/** Validated against outcomes and naive baselines only — never against sportsbook lines. Stays experimental until forward capture says otherwise. */
export const NFL_PROPS_LIFECYCLE = "experimental" as const;

export interface ValidationRow {
  market: PropMarket;
  n: number;
  maeModel: number;
  maeSeasonAvg: number;
  brierModel: number;
  brierSeasonAvg: number;
  deltaLo: number;
  deltaHi: number;
}

export interface TdValidationRow {
  market: string;
  n: number;
  logLossModel: number;
  logLossSeason: number;
  brierModel: number;
  brierSeason: number;
  deltaLo: number;
  deltaHi: number;
}

export interface FrozenTdModel {
  params: TdParams;
  /** Decay half-life (games) for each player's own TD history; season carry follows the usage group. */
  halfLife: number;
  calibrators: { any: { a: number; b: number }; pass: { a: number; b: number } };
  validation: TdValidationRow[];
}

export interface ExtraValidationRow {
  market: string;
  n: number;
  metric: "brier" | "logloss";
  model: number;
  season: number;
  deltaLo: number;
  deltaHi: number;
}

export interface FrozenExtras {
  ratio: Record<"rushRecYards" | "passRushYards", { dist: FrozenRatioDistribution; cal: { a: number; b: number } }>;
  interceptions: { params: IntParams; cal: { a: number; b: number } };
  twoPlusTds: { cal: { a: number; b: number } };
  validation: ExtraValidationRow[];
}

export interface FrozenBatchB {
  /** Single-play survival curves (train): receptions and rushes by position, completions league-wide. */
  curves: { rec: Record<string, SurvivalCurve>; rush: Record<string, SurvivalCurve>; cmp: SurvivalCurve };
  longestCal: Record<"longestReception" | "longestRush" | "longestCompletion", { a: number; b: number }>;
  kick: { params: KickParams; fgCal: { a: number; b: number }; kpDist: FrozenRatioDistribution; kpCal: { a: number; b: number } };
  firstTd: { delta: number; cal: { a: number; b: number } };
  validation: ExtraValidationRow[];
}

export interface FrozenModelFile {
  modelKey: string;
  modelVersion: string;
  frozenAt: string;
  splits: { train: [number, number]; validation: [number, number]; test: [number, number] };
  engine: Record<"usage" | "efficiency" | "team" | "defense", EngineParams>;
  params: ModelParams;
  distributions: Record<PropMarket, FrozenRatioDistribution>;
  calibrators: Record<PropFamily, { a: number; b: number }>;
  validation: ValidationRow[];
  td?: FrozenTdModel;
  extras?: FrozenExtras;
  batchB?: FrozenBatchB;
  dataManifest: Record<string, Record<string, string>>;
}

export interface FrozenModel {
  file: FrozenModelFile;
  /**
   * Calibrated P(stat > line). `mu` is the projected mean; for TD, INT and FG
   * markets it's the Poisson rate λ, and for first TD it's the raw first-TD
   * probability. Longest-play markets need `aux`.
   */
  pOver(market: ServedMarket, mu: number, line: number, aux?: PricingAux): number;
}

let cached: FrozenModel | null = null;

export function loadFrozenModel(): FrozenModel {
  if (cached) return cached;
  const file = frozenJson as unknown as FrozenModelFile;
  if (file.modelVersion !== NFL_PROPS_MODEL_VERSION) {
    throw new Error(`frozen NFL props file is ${file.modelVersion}, code expects ${NFL_PROPS_MODEL_VERSION}`);
  }
  const dists = new Map(PROP_MARKETS.map((m) => [m, RatioDistribution.fromFrozen(file.distributions[m])]));
  const cals = new Map(
    (Object.keys(file.calibrators) as PropFamily[]).map((f) => [f, new LogisticCalibrator(file.calibrators[f].a, file.calibrators[f].b)])
  );
  const td = file.td;
  const tdCal = td
    ? { any: new LogisticCalibrator(td.calibrators.any.a, td.calibrators.any.b), pass: new LogisticCalibrator(td.calibrators.pass.a, td.calibrators.pass.b) }
    : null;
  const clampP = (p: number) => Math.min(0.98, Math.max(0.02, p));
  const ex = file.extras;
  const exRatio = ex
    ? {
        rushRecYards: { dist: RatioDistribution.fromFrozen(ex.ratio.rushRecYards.dist), cal: new LogisticCalibrator(ex.ratio.rushRecYards.cal.a, ex.ratio.rushRecYards.cal.b) },
        passRushYards: { dist: RatioDistribution.fromFrozen(ex.ratio.passRushYards.dist), cal: new LogisticCalibrator(ex.ratio.passRushYards.cal.a, ex.ratio.passRushYards.cal.b) },
      }
    : null;
  const exInt = ex ? new LogisticCalibrator(ex.interceptions.cal.a, ex.interceptions.cal.b) : null;
  const exMulti = ex ? new LogisticCalibrator(ex.twoPlusTds.cal.a, ex.twoPlusTds.cal.b) : null;
  const bb = file.batchB;
  const bbCal = bb
    ? {
        longestReception: new LogisticCalibrator(bb.longestCal.longestReception.a, bb.longestCal.longestReception.b),
        longestRush: new LogisticCalibrator(bb.longestCal.longestRush.a, bb.longestCal.longestRush.b),
        longestCompletion: new LogisticCalibrator(bb.longestCal.longestCompletion.a, bb.longestCal.longestCompletion.b),
        fg: new LogisticCalibrator(bb.kick.fgCal.a, bb.kick.fgCal.b),
        kp: new LogisticCalibrator(bb.kick.kpCal.a, bb.kick.kpCal.b),
        kpDist: RatioDistribution.fromFrozen(bb.kick.kpDist),
        firstTd: new LogisticCalibrator(bb.firstTd.cal.a, bb.firstTd.cal.b),
      }
    : null;
  const curveFor = (market: BatchBMarket, position: string): SurvivalCurve => {
    const c = bb!.curves;
    if (market === "longestReception") return c.rec[position === "QB" ? "WR" : position] ?? c.rec.WR;
    if (market === "longestRush") return c.rush[position] ?? c.rush.RB;
    return c.cmp;
  };
  cached = {
    file,
    pOver: (market, mu, line, aux) => {
      if (isBatchBMarket(market)) {
        if (!bbCal) throw new Error(`frozen model ${file.modelVersion} has no ${market} model`);
        if (market === "fgMade") return bbCal.fg.apply(clampP(poissonOver(mu, line)));
        if (market === "kickingPoints") return bbCal.kp.apply(bbCal.kpDist.pOver(mu, line));
        if (market === "firstTd") return bbCal.firstTd.apply(clampP(mu));
        if (!aux) throw new Error(`${market} needs touches/ypp/position to price`);
        return bbCal[market].apply(clampP(pLongestOver(aux.touches, curveFor(market, aux.position), aux.ypp, line)));
      }
      if (isExtraMarket(market)) {
        if (!exRatio || !exInt || !exMulti) throw new Error(`frozen model ${file.modelVersion} has no ${market} model`);
        if (market === "interceptions") return exInt.apply(clampP(poissonOver(mu, line)));
        // 2+ TDs: `mu` is the anytime-TD rate λ; the market is always "2 or more"
        if (market === "twoPlusTds") return exMulti.apply(clampP(poissonOver(mu, 1.5)));
        return exRatio[market].cal.apply(exRatio[market].dist.pOver(mu, line));
      }
      if (isTdMarket(market)) {
        if (!tdCal) throw new Error(`frozen model ${file.modelVersion} has no touchdown model`);
        return tdCal[market === "anytimeTd" ? "any" : "pass"].apply(clampP(poissonOver(mu, line)));
      }
      return cals.get(MARKET_FAMILY[market])!.apply(dists.get(market)!.pOver(mu, line));
    },
  };
  return cached;
}

/** Median of a longest-play market: the smallest whole-yard line the calibrated model makes ≤50% to clear. */
export function medianLongest(model: FrozenModel, market: "longestReception" | "longestRush" | "longestCompletion", aux: PricingAux): number {
  for (let x = 0; x < 110; x++) if (model.pOver(market, 0, x + 0.5, aux) < 0.5) return x;
  return 110;
}
