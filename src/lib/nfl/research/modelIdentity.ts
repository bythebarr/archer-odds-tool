/**
 * Fixed model identity for the NFL research vertical slice (`/nfl/research`),
 * as recorded onto every `PredictionRun` (see docs/architecture/
 * MODEL-PREDICTION-LIFECYCLE.md and docs/architecture/NFL-RESEARCH.md).
 * Mirrors `src/lib/cfb/modelIdentity.ts`'s own reasoning exactly — see that
 * file's docstring for why `modelVersion` is hand-bumped, never derived from
 * the current git commit.
 *
 * Distinct from `NFL_MODEL` in `src/lib/nfl/model.ts` (the calibration-harness
 * identity used by `npm run backtest:nfl`) — this is the identity for THIS
 * specific vertical slice's stored predictions, not the model layer itself.
 * The underlying Elo math is the exact same `NflElo` class either way.
 */

/** Sport key recorded on every research PredictionRun. Open string, matching PostedPlay.sport's precedent — no `Sport` enum entry needed. */
export const NFL_RESEARCH_SPORT_KEY = "nfl";

/** Stable identifier for the model itself, independent of version. */
export const NFL_RESEARCH_MODEL_KEY = "nfl-elo";

/**
 * Explicit version of the model that produced a given run. Bump by hand when
 * `src/lib/nfl/elo.ts`/`model.ts`'s formula or `DEFAULT_NFL_ELO` change in a
 * way that would produce a different number for the same inputs — this slice
 * never modifies that file, so as of this task the version starts at v0.1.0.
 */
export const NFL_RESEARCH_MODEL_VERSION = "v0.1.0";

/** Version tag for the shape of `ModelPrediction.featureSnapshot` this slice writes. Bump independently of `NFL_RESEARCH_MODEL_VERSION` when that JSON shape changes. */
export const NFL_RESEARCH_FEATURE_SCHEMA_VERSION = "nfl-elo-research-features-v1";

/**
 * Always `experimental`. The existing NFL Elo model is calibration-trusted
 * but CLV-negative (`docs/architecture/calibration.md`'s "NFL (biggest
 * sport)" section) — it does not beat the closing line. This constant must
 * never read `validated` or `production` until that changes, which this task
 * does not attempt.
 */
export const NFL_RESEARCH_LIFECYCLE = "experimental" as const;
