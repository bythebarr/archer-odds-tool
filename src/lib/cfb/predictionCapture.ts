/**
 * Pure CFB-to-PredictionRunInput builder (see docs/architecture/
 * MODEL-PREDICTION-LIFECYCLE.md and docs/architecture/CFB-V0.md). No Prisma,
 * no network, no `Date.now()` — every timestamp is passed in, so this is
 * exhaustively unit-testable and its output is exactly reproducible from its
 * inputs. `src/lib/cfb/capturePredictions.ts` is the thin orchestration layer
 * that actually fetches ESPN and calls `createPredictionRun`; nothing here
 * does either.
 */
import type { CfbGameStatus, CfbRatingBook, CfbScheduleGame, CfbTeamRating } from "./types";
import { predictGame, HOME_FIELD_POINTS, MARGIN_SD, MIN_GAMES_LOW_CONFIDENCE, MIN_GAMES_HIGH_CONFIDENCE } from "./model";
import { ratingOrDefault, SRS_ITERATIONS, SHRINK_GAMES, DEFAULT_LEAGUE_AVG_POINTS, MAX_PLAUSIBLE_SCORE } from "./ratings";
import { CFB_MODEL_KEY, CFB_MODEL_VERSION, CFB_FEATURE_SCHEMA_VERSION, CFB_MODEL_LIFECYCLE } from "./modelIdentity";
import type { PredictionInput, PredictionRunInput } from "@/lib/predictions";

/** Sport key recorded on every CFB PredictionRun — CFB has no `Sport` enum entry (see CFB-V0.md), so this is a plain string like every other open identity field in the predictions module. */
export const CFB_SPORT_KEY = "cfb";

/** `marketKey`/`selectionKey` convention for CFB v0's moneyline-shaped win-probability predictions. Two rows per game (home + away) — see this module's own docstring on `buildCfbPredictionRun` for why, and how to count games without double-counting. */
export const CFB_H2H_MARKET_KEY = "h2h";
export type CfbSelectionKey = "home" | "away";

/** Why one game's slate entry produced no prediction. */
export type CfbExclusionReason =
  | "status:live"
  | "status:final"
  | "status:postponed"
  | "status:other"
  | "already-started";

export interface CfbCaptureExclusion {
  espnEventId: string;
  reason: CfbExclusionReason;
}

/** Every named heuristic constant needed to reproduce this prediction's numbers — see CFB-V0.md's "Heuristic constants" table for what each one means. Frozen here per-prediction rather than trusted of "whatever's in source today," since these are hand-bumped, not backed by a version history of their own. */
export interface CfbModelConstants {
  homeFieldPoints: number;
  marginSd: number;
  srsIterations: number;
  shrinkGames: number;
  defaultLeagueAvgPoints: number;
  maxPlausibleScore: number;
  minGamesLowConfidence: number;
  minGamesHighConfidence: number;
}

function currentCfbModelConstants(): CfbModelConstants {
  return {
    homeFieldPoints: HOME_FIELD_POINTS,
    marginSd: MARGIN_SD,
    srsIterations: SRS_ITERATIONS,
    shrinkGames: SHRINK_GAMES,
    defaultLeagueAvgPoints: DEFAULT_LEAGUE_AVG_POINTS,
    maxPlausibleScore: MAX_PLAUSIBLE_SCORE,
    minGamesLowConfidence: MIN_GAMES_LOW_CONFIDENCE,
    minGamesHighConfidence: MIN_GAMES_HIGH_CONFIDENCE,
  };
}

function ratingSnapshot(r: CfbTeamRating) {
  return {
    offenseRating: r.offenseRating,
    defenseRating: r.defenseRating,
    netRating: r.netRating,
    gamesPlayed: r.gamesPlayed,
    strengthOfSchedule: r.strengthOfSchedule,
  };
}

/** The exact feature/input snapshot a CFB v0 prediction used — see requirement list in the task that produced this file, and CFB-V0.md's "Model formula". */
export interface CfbPredictionFeatureSnapshot {
  espnEventId: string;
  scheduledStartUtc: string; // ISO — JSON payloads can't hold a Date
  neutralSite: boolean;
  leagueAvgPoints: number;
  homeTeamId: string;
  awayTeamId: string;
  homeRating: ReturnType<typeof ratingSnapshot>;
  awayRating: ReturnType<typeof ratingSnapshot>;
  /** The actual home-field points applied to this projection (0 if neutral site) — `predictGame`'s own `drivers.homeFieldPoints`, not recomputed separately, so this can never drift from what the model actually used. */
  homeFieldPointsApplied: number;
  dataAsOfUtc: string; // ISO — the exact cutoff buildTeamRatings was called with for this run
  constants: CfbModelConstants;
}

/** Only what v0's own declared feature schema can be incomplete about — see this module's docstring on why weather/injuries/etc. are never reported "missing" here. */
export interface CfbMissingInputs {
  homeTeamUnrated: boolean;
  awayTeamUnrated: boolean;
}

/** The model's output for one game — never a probability against a market line that doesn't exist (see `buildCfbPredictionRun`'s docstring). */
export interface CfbPredictionProjection {
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedMargin: number;
  projectedTotal: number;
  confidence: "low" | "medium" | "high";
  minGamesPlayed: number;
}

export interface CfbCaptureResult {
  /** Null when nothing was eligible — the caller must NOT write an empty PredictionRun (see the storage layer's own "predictions must contain at least one entry" rule). */
  runInput: PredictionRunInput | null;
  eligibleGameCount: number;
  exclusions: CfbCaptureExclusion[];
}

function statusExclusionReason(status: CfbGameStatus): CfbExclusionReason | null {
  switch (status) {
    case "scheduled":
      return null;
    case "live":
      return "status:live";
    case "final":
      return "status:final";
    case "postponed":
      return "status:postponed";
    case "other":
      return "status:other";
  }
}

/**
 * Builds one CFB `PredictionRunInput` from an already-fetched slate and an
 * already-built rating book — pure, deterministic, no I/O. `generatedAt` and
 * `dataAsOfUtc` are caller-supplied (see `capturePredictions.ts`, which
 * captures a single `now` and passes the SAME value as both the rating
 * book's own cutoff and these two fields, so what's stamped on the record
 * always exactly matches the cutoff `buildTeamRatings` was actually called
 * with — never a separately-recomputed approximation of it).
 *
 * Eligibility (temporal integrity): a game is included only if its status is
 * "scheduled" AND its `startUtc` is STRICTLY after `generatedAt` — anything
 * live/final/postponed/other-status, or nominally "scheduled" but whose
 * kickoff has already passed `generatedAt`, is excluded with a reason. This
 * can never use a target game's own result: only "scheduled, not yet
 * started" games ever reach the prediction step, and ratings come from a
 * SEPARATE completed-games list already bounded by the same cutoff.
 *
 * TWO predictions are written per eligible game — one `home` and one `away`
 * selection under the SAME `marketKey: "h2h"` — mirroring how every other
 * sport in this codebase represents a two-way moneyline (see `Side`/
 * `GameOutcome` in prisma/schema.prisma: one row per team, not one row per
 * game). Both rows carry the full game-level `projection` payload (scores,
 * margin, total, confidence) — deliberately duplicated rather than requiring
 * a join back to a sibling row to read it. IMPORTANT for later evaluation:
 * do NOT count "games predicted" by counting `ModelPrediction` rows for this
 * model — two rows share one game. Count distinct
 * `(eventRef, marketKey)` pairs, or divide the row count by two.
 *
 * No `spreads`/`totals` market rows, and no spread-cover/over-under
 * probability, are ever produced here: CFB v0 has no server-side market line
 * (see CFB-V0.md's "Manual market workflow" — lines live only in the
 * owner's own browser `localStorage`), and computing a probability against a
 * line this collector can't see would be fabricating a "market prediction"
 * that doesn't correspond to any real, known line. `projectedMargin`/
 * `projectedTotal` ARE preserved — as plain model output values, inside the
 * h2h rows' `projection` JSON, never as a probability.
 */
export function buildCfbPredictionRun(params: {
  slate: readonly CfbScheduleGame[];
  ratingBook: CfbRatingBook;
  generatedAt: Date;
  dataAsOfUtc: Date;
  dateEt: string;
}): CfbCaptureResult {
  const { slate, ratingBook, generatedAt, dataAsOfUtc, dateEt } = params;

  const exclusions: CfbCaptureExclusion[] = [];
  const predictions: PredictionInput[] = [];
  let eligibleGameCount = 0;

  for (const game of slate) {
    const statusReason = statusExclusionReason(game.status);
    if (statusReason) {
      exclusions.push({ espnEventId: game.espnEventId, reason: statusReason });
      continue;
    }
    if (game.startUtc.getTime() <= generatedAt.getTime()) {
      exclusions.push({ espnEventId: game.espnEventId, reason: "already-started" });
      continue;
    }

    eligibleGameCount++;

    const homeRating = ratingOrDefault(ratingBook.ratings, game.home.espnTeamId);
    const awayRating = ratingOrDefault(ratingBook.ratings, game.away.espnTeamId);
    const prediction = predictGame(homeRating, awayRating, ratingBook.leagueAvgPoints, {
      neutralSite: game.neutralSite,
    });

    const featureSnapshot: CfbPredictionFeatureSnapshot = {
      espnEventId: game.espnEventId,
      scheduledStartUtc: game.startUtc.toISOString(),
      neutralSite: game.neutralSite,
      leagueAvgPoints: ratingBook.leagueAvgPoints,
      homeTeamId: game.home.espnTeamId,
      awayTeamId: game.away.espnTeamId,
      homeRating: ratingSnapshot(homeRating),
      awayRating: ratingSnapshot(awayRating),
      homeFieldPointsApplied: prediction.drivers.homeFieldPoints,
      dataAsOfUtc: dataAsOfUtc.toISOString(),
      constants: currentCfbModelConstants(),
    };

    const missingInputs: CfbMissingInputs = {
      homeTeamUnrated: !ratingBook.ratings.has(game.home.espnTeamId),
      awayTeamUnrated: !ratingBook.ratings.has(game.away.espnTeamId),
    };

    const projection: CfbPredictionProjection = {
      projectedHomeScore: prediction.projectedHomeScore,
      projectedAwayScore: prediction.projectedAwayScore,
      projectedMargin: prediction.projectedMargin,
      projectedTotal: prediction.projectedTotal,
      confidence: prediction.confidence,
      minGamesPlayed: prediction.drivers.minGamesPlayed,
    };

    const shared = {
      eventRef: game.espnEventId,
      scheduledStartUtc: game.startUtc,
      marketKey: CFB_H2H_MARKET_KEY,
      featureSnapshot: featureSnapshot as unknown as PredictionInput["featureSnapshot"],
      missingInputs: missingInputs as unknown as PredictionInput["missingInputs"],
      projection: projection as unknown as PredictionInput["projection"],
    };

    predictions.push({ ...shared, selectionKey: "home" satisfies CfbSelectionKey, probability: prediction.homeWinProb });
    predictions.push({ ...shared, selectionKey: "away" satisfies CfbSelectionKey, probability: prediction.awayWinProb });
  }

  if (predictions.length === 0) {
    return { runInput: null, eligibleGameCount, exclusions };
  }

  const runInput: PredictionRunInput = {
    sportKey: CFB_SPORT_KEY,
    modelKey: CFB_MODEL_KEY,
    modelVersion: CFB_MODEL_VERSION,
    lifecycle: CFB_MODEL_LIFECYCLE,
    generatedAt,
    dataAsOfUtc,
    featureSchemaVersion: CFB_FEATURE_SCHEMA_VERSION,
    runMetadata: { capturedForDateEt: dateEt, eligibleGameCount, exclusionCount: exclusions.length },
    predictions,
  };

  return { runInput, eligibleGameCount, exclusions };
}
