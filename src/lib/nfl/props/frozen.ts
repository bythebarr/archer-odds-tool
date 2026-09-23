/**
 * The frozen, versioned NFL prop model — every fitted number the experiment
 * produced, written once by `NFL_PROPS_FREEZE=1 npm run experiment:nfl:props`
 * into `frozen/nfl-props-<version>.json` and never hand-edited. Everything the
 * app serves (projections, over/under probabilities) goes through this, so a
 * stored prediction is always reproducible from (version, inputs).
 *
 * Bump `NFL_PROPS_MODEL_VERSION` whenever a refit would change any number.
 */
import frozenJson from "./frozen/nfl-props-v1.2.0.json";
import { LogisticCalibrator, RatioDistribution, type FrozenRatioDistribution } from "./distribution";
import { MARKET_FAMILY, type PropFamily } from "./eligibility";
import type { EngineParams } from "./engine";
import { PROP_MARKETS, type ModelParams, type PropMarket } from "./model";
import { isTdMarket, poissonOver, type TdMarket, type TdParams } from "./td";

/** Every market the app serves: the yardage/volume markets plus touchdown markets (v1.2). */
export type ServedMarket = PropMarket | TdMarket;

export const NFL_PROPS_SPORT_KEY = "nfl";
export const NFL_PROPS_MODEL_KEY = "nfl-props";
/**
 * v1.1.0 = v1.0.0 + carry-share redistribution when a teammate is ruled out.
 * v1.2.0 = v1.1.0 + touchdown markets (anytime TD, passing TDs), all
 * existing numbers unchanged. Each passed validation; see
 * docs/architecture/NFL-PROPS-MODEL.md. Earlier frozen files are kept for the record.
 */
export const NFL_PROPS_MODEL_VERSION = "v1.2.0";
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
  dataManifest: Record<string, Record<string, string>>;
}

export interface FrozenModel {
  file: FrozenModelFile;
  /** Calibrated P(stat > line) for a projected mean (for TD markets, the mean is the Poisson rate λ). */
  pOver(market: ServedMarket, mu: number, line: number): number;
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
  cached = {
    file,
    pOver: (market, mu, line) => {
      if (isTdMarket(market)) {
        if (!tdCal) throw new Error(`frozen model ${file.modelVersion} has no touchdown model`);
        return tdCal[market === "anytimeTd" ? "any" : "pass"].apply(clampP(poissonOver(mu, line)));
      }
      return cals.get(MARKET_FAMILY[market])!.apply(dists.get(market)!.pOver(mu, line));
    },
  };
  return cached;
}
