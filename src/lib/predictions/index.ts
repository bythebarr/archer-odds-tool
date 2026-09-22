/**
 * The generic, sport-agnostic prediction-history module. See
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md. No sport writes here yet —
 * this is the foundation a future per-sport writer (CFB first) plugs into.
 */
export type { JsonValue, ModelLifecycle, PredictionInput, PredictionRunInput, CreatedPredictionRun } from "./types";
export { validatePredictionRunInput, assertValidPredictionRunInput, isJsonSerializable, PredictionValidationError } from "./validate";
export { createPredictionRun } from "./store";
