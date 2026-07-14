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
  SportModel,
  IngestSummary,
  MarketSpec,
  PropSpec,
} from "./types";
export { SPORTS, sportByKey, getAdapter } from "./registry";
export { mlbAdapter } from "./adapters/mlb";
export { ufcAdapter } from "./adapters/ufc";
