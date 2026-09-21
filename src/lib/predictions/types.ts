/**
 * Generic, sport-agnostic types for the point-in-time prediction record
 * (see docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). No sport-, provider-,
 * or Discord-specific imports on purpose — this is the engine/storage
 * boundary every future sport's writer plugs into, not a CFB/MLB module.
 */

/** A model's lifecycle stage — mirrors the `ModelLifecycle` Prisma enum. */
export type ModelLifecycle = "experimental" | "validated" | "production";

/**
 * A JSON-serializable value. Deliberately excludes `undefined`, functions,
 * `Date`, `NaN`/`Infinity`, and anything else `JSON.stringify` can't round
 * -trip — the point-in-time fields (generatedAt, dataAsOfUtc,
 * scheduledStartUtc) are typed `Date` on their own dedicated fields, never
 * inside one of these payloads.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** One immutable prediction within a run. See ModelPrediction's schema docstring. */
export interface PredictionInput {
  /** Open string event id (ESPN event id, Game.id, UfcBout.id, ...). */
  eventRef: string;
  /** The event's scheduled kickoff/start, as known at generation time. */
  scheduledStartUtc: Date;
  /** Open string market identifier, e.g. "h2h", "spreads", "player_hits". */
  marketKey: string;
  /** Open string selection/side identifier, e.g. "home", "over", a player id. */
  selectionKey: string;
  /** The model's probability for this selection, when it produces one. */
  probability?: number | null;
  /** Projected value(s) or a distribution — shape is model-specific. */
  projection?: JsonValue;
  /** The exact feature/input snapshot the model used. Required — never optional. */
  featureSnapshot: JsonValue;
  /** Which inputs were missing/unavailable/stale at generation time. */
  missingInputs?: JsonValue;
  /** The market line(s) known at generation time, if any. */
  marketSnapshot?: JsonValue;
}

/** One point-in-time execution of one versioned model, with its predictions. See PredictionRun's schema docstring. */
export interface PredictionRunInput {
  /** Open string, not the `Sport` enum — a sport with no Game/Team rows can still write here. */
  sportKey: string;
  /** Stable model identifier, independent of modelVersion. */
  modelKey: string;
  /** Explicit version of the model that produced this run. */
  modelVersion: string;
  /** The model's lifecycle stage at the moment this run was generated. Required — never defaulted. */
  lifecycle: ModelLifecycle;
  /** When this run was executed. Must precede every prediction's scheduledStartUtc. */
  generatedAt: Date;
  /** Strict "as of" cutoff the model's inputs were restricted to. Must precede every prediction's scheduledStartUtc. */
  dataAsOfUtc: Date;
  /** Frozen copy of the calibration/trust snapshot active when this run was generated. */
  calibrationSnapshot?: JsonValue;
  /** Version tag for the shape of each prediction's featureSnapshot. */
  featureSchemaVersion: string;
  /** Freeform, run-level metadata. Never read by validation/storage logic. */
  runMetadata?: JsonValue;
  /** One or more predictions produced by this run. */
  predictions: PredictionInput[];
}

/** What `createPredictionRun` returns on success. */
export interface CreatedPredictionRun {
  runId: string;
  predictionIds: string[];
}
