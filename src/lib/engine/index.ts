/**
 * The sport-agnostic engine. See docs/architecture/sport-engine.md.
 * Barrel for the contract types and the sport registry.
 */
export type {
  Play,
  PlayDisplay,
  PlayGrade,
  SelectionSpec,
  SportAdapter,
  SportMeta,
  SportModel,
  ModelBacktest,
  CalibrationSnapshot,
  IngestSummary,
  MarketSpec,
  PropSpec,
} from "./types";
export { SPORTS, sportByKey, getAdapter } from "./registry";
export { modelCalibration, isModelTrusted } from "./trust";
export type { SportKey, SlateSport, NavSport } from "./registry";
export { postedPlayToPlay } from "./posted";
export { mlbAdapter } from "./adapters/mlb";
export { ufcAdapter } from "./adapters/ufc";
export { tennisAdapter } from "./adapters/tennis";
export { soccerAdapter } from "./adapters/soccer";
export { f1Adapter } from "./adapters/f1";
