/**
 * Pure NFL-research-to-PredictionRunInput builder, plus the single shared
 * "compute one game's prediction" function the display page and the storage
 * path both call — so display and storage can never independently drift
 * (see docs/architecture/MODEL-PREDICTION-LIFECYCLE.md and CFB's identical
 * discipline in `src/lib/cfb/predictionCapture.ts`). No Prisma, no network —
 * every input (schedule, Elo book) is caller-supplied, so this is
 * exhaustively unit-testable and its output is exactly reproducible.
 */
import { MIN_GAMES_FOR_SIGNAL } from "../model";
import type { NflElo, NflEloOpts } from "../elo";
import type { NflEloAsOfBook } from "./eloAsOf";
import type { NflResearchGameStatus, NflScheduleGame } from "./espnSchedule";
import { resolveNflTeamIdentity, validateNflverseCode, type NflTeamIdentity } from "./teamIdentity";
import {
  NFL_RESEARCH_SPORT_KEY,
  NFL_RESEARCH_MODEL_KEY,
  NFL_RESEARCH_MODEL_VERSION,
  NFL_RESEARCH_FEATURE_SCHEMA_VERSION,
  NFL_RESEARCH_LIFECYCLE,
} from "./modelIdentity";
import type { PredictionInput, PredictionRunInput } from "@/lib/predictions";

export const NFL_RESEARCH_H2H_MARKET_KEY = "h2h";
export type NflResearchSelectionKey = "home" | "away";

/** One game's model output — the SAME object the page renders and the builder stores. Never a totals or spread-cover probability (see this module's docstring and requirement 4 of the task that produced this file). */
export interface NflGamePrediction {
  homeWinProb: number;
  awayWinProb: number;
  /** Points, home perspective — a plain model output value, never described as a validated spread edge. */
  expectedHomeMargin: number;
  homeRating: number;
  awayRating: number;
  homeGamesPlayed: number;
  awayGamesPlayed: number;
  homeLowHistory: boolean;
  awayLowHistory: boolean;
  homeUnrated: boolean;
  awayUnrated: boolean;
  /** Human-readable, e.g. "away team has only 3 tracked games..." — the same strings shown on the page and frozen into missingInputs. */
  warnings: string[];
}

/**
 * The one place win probability, expected margin, and missing-data warnings
 * are computed — calls `NflElo`'s own methods directly (`winProbHome`,
 * `expectedHomeMargin`, `rating`, `gamesPlayed`), never re-derives them.
 * `MIN_GAMES_FOR_SIGNAL` is the same threshold `collectNflSamples` already
 * uses to decide whether Elo has signal (`src/lib/nfl/model.ts`), exported
 * from there rather than duplicated as a new literal.
 */
export function computeNflGamePrediction(elo: NflElo, homeCode: string, awayCode: string): NflGamePrediction {
  const homeWinProb = elo.winProbHome(homeCode, awayCode);
  const awayWinProb = 1 - homeWinProb;
  const expectedHomeMargin = elo.expectedHomeMargin(homeCode, awayCode);
  const homeGamesPlayed = elo.gamesPlayed(homeCode);
  const awayGamesPlayed = elo.gamesPlayed(awayCode);
  const homeUnrated = homeGamesPlayed === 0;
  const awayUnrated = awayGamesPlayed === 0;
  const homeLowHistory = homeGamesPlayed < MIN_GAMES_FOR_SIGNAL;
  const awayLowHistory = awayGamesPlayed < MIN_GAMES_FOR_SIGNAL;

  const warnings: string[] = [];
  if (homeUnrated) {
    warnings.push("Home team has no prior games in this reconstruction — rating is the model's default baseline, not a real estimate.");
  } else if (homeLowHistory) {
    warnings.push(`Home team has only ${homeGamesPlayed} tracked game${homeGamesPlayed === 1 ? "" : "s"} — below the model's own ${MIN_GAMES_FOR_SIGNAL}-game signal threshold.`);
  }
  if (awayUnrated) {
    warnings.push("Away team has no prior games in this reconstruction — rating is the model's default baseline, not a real estimate.");
  } else if (awayLowHistory) {
    warnings.push(`Away team has only ${awayGamesPlayed} tracked game${awayGamesPlayed === 1 ? "" : "s"} — below the model's own ${MIN_GAMES_FOR_SIGNAL}-game signal threshold.`);
  }

  return {
    homeWinProb,
    awayWinProb,
    expectedHomeMargin,
    homeRating: elo.rating(homeCode),
    awayRating: elo.rating(awayCode),
    homeGamesPlayed,
    awayGamesPlayed,
    homeLowHistory,
    awayLowHistory,
    homeUnrated,
    awayUnrated,
    warnings,
  };
}

export type NflResearchExclusionReason =
  | "status:live"
  | "status:final"
  | "status:postponed"
  | "status:other"
  | "already-started"
  | "unknown-espn-team"
  | "unresolved-nflverse-identity";

export interface NflResearchExclusion {
  espnEventId: string;
  reason: NflResearchExclusionReason;
  /** Present for the two identity-related reasons — names which side and what name/code failed to resolve/validate. */
  detail?: string;
}

/** One eligible game's full display+storage bundle — what the page renders per card. */
export interface NflResearchEligibleGame {
  game: NflScheduleGame;
  homeIdentity: NflTeamIdentity;
  awayIdentity: NflTeamIdentity;
  prediction: NflGamePrediction;
}

export interface NflResearchSlate {
  eligible: NflResearchEligibleGame[];
  exclusions: NflResearchExclusion[];
}

function statusExclusionReason(status: NflResearchGameStatus): NflResearchExclusionReason | null {
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
 * Resolves and predicts every eligible game in a schedule. Shared by the
 * page (display) and `buildNflResearchPredictionRun` below (storage) — both
 * call this exact function, so a rendered card and a stored prediction can
 * never disagree. Temporal eligibility: `"scheduled"`-status only, and
 * `startUtc` strictly after `generatedAt` (mirrors CFB's identical rule).
 * Team-identity validation: BOTH sides must resolve via `lookupNflTeam`
 * (rejecting anything not one of the 32 NFL teams) AND have their resolved
 * nflverse code actually present in `eloBook.teamsSeen` (rejecting a
 * resolution the fetched data itself can't back up) — see teamIdentity.ts's
 * own docstrings for why this is checked explicitly rather than assumed.
 *
 * An emergent safety property worth naming: since `teamsSeen` is built only
 * from games actually replayed, a team can be in it only with `gamesPlayed
 * >= 1` — so if the nflverse fetch genuinely failed and returned nothing
 * (an empty `eloBook`), EVERY game is excluded as `unresolved-nflverse-
 * identity` rather than silently predicted off a fabricated zero-history
 * baseline. `computeNflGamePrediction`'s `homeUnrated`/`awayUnrated` branch
 * is therefore unreachable through this pipeline for any team that clears
 * identity validation — it stays as a correct, direct guard on that function
 * (see its own tests), not dead weight to remove.
 */
export function buildNflResearchSlate(params: {
  schedule: readonly NflScheduleGame[];
  eloBook: NflEloAsOfBook;
  generatedAt: Date;
}): NflResearchSlate {
  const { schedule, eloBook, generatedAt } = params;
  const eligible: NflResearchEligibleGame[] = [];
  const exclusions: NflResearchExclusion[] = [];

  for (const game of schedule) {
    const statusReason = statusExclusionReason(game.status);
    if (statusReason) {
      exclusions.push({ espnEventId: game.espnEventId, reason: statusReason });
      continue;
    }
    if (game.startUtc.getTime() <= generatedAt.getTime()) {
      exclusions.push({ espnEventId: game.espnEventId, reason: "already-started" });
      continue;
    }

    const homeIdentity = resolveNflTeamIdentity(game.homeName);
    const awayIdentity = resolveNflTeamIdentity(game.awayName);
    if (!homeIdentity) {
      exclusions.push({ espnEventId: game.espnEventId, reason: "unknown-espn-team", detail: `home: "${game.homeName}"` });
      continue;
    }
    if (!awayIdentity) {
      exclusions.push({ espnEventId: game.espnEventId, reason: "unknown-espn-team", detail: `away: "${game.awayName}"` });
      continue;
    }
    if (!validateNflverseCode(homeIdentity, eloBook.teamsSeen)) {
      exclusions.push({
        espnEventId: game.espnEventId,
        reason: "unresolved-nflverse-identity",
        detail: `home: "${homeIdentity.espnName}" resolved to nflverse code "${homeIdentity.nflverseCode}", which never appears in the fetched history`,
      });
      continue;
    }
    if (!validateNflverseCode(awayIdentity, eloBook.teamsSeen)) {
      exclusions.push({
        espnEventId: game.espnEventId,
        reason: "unresolved-nflverse-identity",
        detail: `away: "${awayIdentity.espnName}" resolved to nflverse code "${awayIdentity.nflverseCode}", which never appears in the fetched history`,
      });
      continue;
    }

    const prediction = computeNflGamePrediction(eloBook.elo, homeIdentity.nflverseCode, awayIdentity.nflverseCode);
    eligible.push({ game, homeIdentity, awayIdentity, prediction });
  }

  return { eligible, exclusions };
}

/** The exact feature/input snapshot one NFL research prediction used. */
export interface NflEloFeatureSnapshot {
  espnEventId: string;
  scheduledStartUtc: string; // ISO
  homeName: string;
  awayName: string;
  homeNflverseCode: string;
  awayNflverseCode: string;
  homeRating: number;
  awayRating: number;
  homeGamesPlayed: number;
  awayGamesPlayed: number;
  dataAsOfUtc: string; // ISO — the exact cutoff buildNflEloAsOf was called with
  eloOpts: NflEloOpts;
}

export interface NflMissingInputs {
  homeUnrated: boolean;
  awayUnrated: boolean;
  homeLowHistory: boolean;
  awayLowHistory: boolean;
  warnings: string[];
}

export interface NflResearchProjection {
  expectedHomeMargin: number;
}

export interface NflResearchRunResult {
  runInput: PredictionRunInput | null;
  slate: NflResearchSlate;
}

/**
 * Builds one NFL research `PredictionRunInput` from an already-built slate.
 * No `spreads`/`totals` market rows and no spread-cover/over-under
 * probability are ever produced — this model has no market line to compare
 * against in this pass (see requirement 4/5 of the task that produced this
 * file) — `expectedHomeMargin` is preserved only as plain projection
 * metadata. TWO predictions per game (`home`/`away`, same `marketKey:
 * "h2h"`), complementary probabilities — count distinct `(eventRef,
 * marketKey)` pairs when evaluating, never rows (identical rule to CFB's).
 */
export function buildNflResearchPredictionRun(params: {
  slate: NflResearchSlate;
  /** The Elo options actually used to build the slate's ratings — always `eloBook.opts` from the same `buildNflEloAsOf` call, never re-assumed here (see `DEFAULT_NFL_ELO`'s own docstring: freezing the wrong options would misrepresent what actually produced this run's numbers). */
  eloOpts: NflEloOpts;
  generatedAt: Date;
  dataAsOfUtc: Date;
}): NflResearchRunResult {
  const { slate, eloOpts, generatedAt, dataAsOfUtc } = params;
  const predictions: PredictionInput[] = [];

  for (const { game, homeIdentity, awayIdentity, prediction } of slate.eligible) {
    const featureSnapshot: NflEloFeatureSnapshot = {
      espnEventId: game.espnEventId,
      scheduledStartUtc: game.startUtc.toISOString(),
      homeName: homeIdentity.espnName,
      awayName: awayIdentity.espnName,
      homeNflverseCode: homeIdentity.nflverseCode,
      awayNflverseCode: awayIdentity.nflverseCode,
      homeRating: prediction.homeRating,
      awayRating: prediction.awayRating,
      homeGamesPlayed: prediction.homeGamesPlayed,
      awayGamesPlayed: prediction.awayGamesPlayed,
      dataAsOfUtc: dataAsOfUtc.toISOString(),
      eloOpts: { ...eloOpts },
    };

    const missingInputs: NflMissingInputs = {
      homeUnrated: prediction.homeUnrated,
      awayUnrated: prediction.awayUnrated,
      homeLowHistory: prediction.homeLowHistory,
      awayLowHistory: prediction.awayLowHistory,
      warnings: prediction.warnings,
    };

    const projection: NflResearchProjection = { expectedHomeMargin: prediction.expectedHomeMargin };

    const shared = {
      eventRef: game.espnEventId,
      scheduledStartUtc: game.startUtc,
      marketKey: NFL_RESEARCH_H2H_MARKET_KEY,
      featureSnapshot: featureSnapshot as unknown as PredictionInput["featureSnapshot"],
      missingInputs: missingInputs as unknown as PredictionInput["missingInputs"],
      projection: projection as unknown as PredictionInput["projection"],
    };

    predictions.push({ ...shared, selectionKey: "home" satisfies NflResearchSelectionKey, probability: prediction.homeWinProb });
    predictions.push({ ...shared, selectionKey: "away" satisfies NflResearchSelectionKey, probability: prediction.awayWinProb });
  }

  if (predictions.length === 0) {
    return { runInput: null, slate };
  }

  const runInput: PredictionRunInput = {
    sportKey: NFL_RESEARCH_SPORT_KEY,
    modelKey: NFL_RESEARCH_MODEL_KEY,
    modelVersion: NFL_RESEARCH_MODEL_VERSION,
    lifecycle: NFL_RESEARCH_LIFECYCLE,
    generatedAt,
    dataAsOfUtc,
    featureSchemaVersion: NFL_RESEARCH_FEATURE_SCHEMA_VERSION,
    runMetadata: {
      eligibleGameCount: slate.eligible.length,
      exclusionCount: slate.exclusions.length,
    },
    predictions,
  };

  return { runInput, slate };
}
