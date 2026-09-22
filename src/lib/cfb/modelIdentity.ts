/**
 * CFB v0's fixed model identity, as recorded onto every `PredictionRun` (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md and
 * src/lib/predictions/types.ts). Deliberately its own tiny file rather than
 * folded into model.ts/ratings.ts — those two are the model's actual math and
 * stay pure/untouched by this; this is metadata ABOUT the model.
 *
 * Bumped by hand, on purpose. `modelVersion` does NOT derive from the current
 * git commit/build SHA at runtime: a git SHA identifies a whole repository
 * checkout, not "which version of the CFB model produced this number" — it
 * would change on every unrelated commit (a typo fix in an unrelated sport's
 * doc) and stay silent through an actual model change made without a new
 * commit yet (e.g. local testing). A hand-bumped string is bumped exactly
 * when — and only when — ratings.ts/model.ts's formula or constants change in
 * a way that would produce a different number for the same inputs.
 *
 * No existing model in this codebase has an explicit version string to
 * mirror (MLB's `MLB_MODEL.calibration.asOf` versions the last BACKTEST run,
 * not the model code itself) — this is the smallest new convention that
 * satisfies PredictionRunInput's requirement, not an attempt to invent a
 * general versioning scheme for every future model.
 */

/** Stable identifier for CFB v0's rating/prediction model, independent of version. */
export const CFB_MODEL_KEY = "cfb-srs";

/** Explicit version of the CFB model that produced a given run. Bump by hand when ratings.ts/model.ts's formula or named constants change. */
export const CFB_MODEL_VERSION = "v0.1.0";

/**
 * Version tag for the shape of `ModelPrediction.featureSnapshot` this model
 * writes (see `CfbPredictionFeatureSnapshot` in predictionCapture.ts). Bump
 * when that shape changes, independent of `CFB_MODEL_VERSION` — the model's
 * math and the snapshot's JSON shape can each change without the other.
 */
export const CFB_FEATURE_SCHEMA_VERSION = "cfb-srs-features-v1";

/**
 * CFB v0 is explicitly experimental (see docs/architecture/CFB-V0.md's
 * "Non-goals": "Not a proven model... Nothing here has been backtested").
 * Never `validated` or `production` until that changes — this constant is
 * the single place that would need to change, and changing it is a decision
 * this task deliberately does not make.
 */
export const CFB_MODEL_LIFECYCLE = "experimental" as const;
