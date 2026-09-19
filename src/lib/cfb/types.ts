/**
 * CFB v0 — shared types for the experimental college-football research board.
 *
 * Deliberately separate from every other sport's types: CFB v0 has no Prisma
 * model, no Sport enum entry, and no Game/Team rows (see docs/architecture/
 * CFB-V0.md). Everything here is plain data computed fresh from ESPN's free
 * scoreboard plus a pure in-memory rating model — nothing persists server-side.
 */

/** Collapsed from ESPN's many `status.type.name` values into the four the task asks to distinguish, plus a safety bucket for anything unrecognized. */
export type CfbGameStatus = "scheduled" | "live" | "final" | "postponed" | "other";

/** One team as it appears on a parsed ESPN event. */
export interface CfbTeamRef {
  /** ESPN's own numeric team id, as a string — the join key. Stable across name changes; no hardcoded roster needed (unlike NFL's CFL-filtering allowlist, which doesn't apply here). */
  espnTeamId: string;
  /** Full display name, e.g. "Ohio State Buckeyes". */
  displayName: string;
  /** Short/abbreviated form, e.g. "OSU", when ESPN provides one. */
  abbreviation: string | null;
  /** Overall win-loss record summary, e.g. "2-0", when ESPN provides one. */
  record: string | null;
}

/** One parsed game from ESPN's college-football scoreboard, scheduled or completed. */
export interface CfbScheduleGame {
  /** ESPN's own event id — for debugging/dedupe only, never joined against another provider. */
  espnEventId: string;
  startUtc: Date;
  status: CfbGameStatus;
  neutralSite: boolean;
  home: CfbTeamRef;
  away: CfbTeamRef;
  /** Present once the game has started; null pre-kickoff. */
  homeScore: number | null;
  awayScore: number | null;
}

/** The subset of a finished game the rating model consumes. */
export interface CfbCompletedGame {
  /** ESPN's event id — the dedup key. Two completed games with the same id are the same event and must not both enter the ratings (see `buildTeamRatings`'s own defensive dedup). */
  espnEventId: string;
  startUtc: Date;
  neutralSite: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

/** Confidence in a team's rating, driven mainly by sample size. */
export type CfbConfidenceLevel = "low" | "medium" | "high";

/** Output of `buildTeamRatings`: per-team ratings plus the league-average points value they were computed relative to — model.ts needs the same number back to reconstruct actual projected scores from "points above average" ratings. */
export interface CfbRatingBook {
  ratings: Map<string, CfbTeamRating>;
  leagueAvgPoints: number;
}

/** One team's opponent-adjusted rating as of a given cutoff. */
export interface CfbTeamRating {
  teamId: string;
  /** Points above league average this team scores, opponent-adjusted, shrunk for sample size. */
  offenseRating: number;
  /** Points above league average this team allows, opponent-adjusted, shrunk for sample size (negative = stingier than average). */
  defenseRating: number;
  /** offenseRating - defenseRating; the single-number net strength used for the win-prob model. */
  netRating: number;
  gamesPlayed: number;
  /** Average net rating of opponents faced so far — the schedule-strength context the task asks to expose. */
  strengthOfSchedule: number;
}

/** Named, human-readable driver values for the page's "why" panel. Presentation data, computed by the model so the UI carries zero model logic. */
export interface CfbPredictionDrivers {
  offenseEdge: number; // home offenseRating - away offenseRating
  defenseEdge: number; // away defenseRating - home defenseRating (positive favors home)
  scheduleStrengthEdge: number; // home SOS - away SOS
  homeFieldPoints: number; // 0 when neutral
  minGamesPlayed: number; // the smaller of the two teams' sample sizes
}

/** One game's model output. Always carries the "experimental/unvalidated" framing at render time — never described as calibrated. */
export interface CfbGamePrediction {
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedMargin: number; // home - away
  projectedTotal: number;
  homeWinProb: number;
  awayWinProb: number; // 1 - homeWinProb, always
  confidence: CfbConfidenceLevel;
  drivers: CfbPredictionDrivers;
}

/** One game's manually-entered market comparison, home perspective. Persisted only in the browser (localStorage) — never sent to a server or written to a database. */
export interface ManualMarketEntry {
  homeSpread: number | null;
  marketTotal: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export const EMPTY_MANUAL_MARKET_ENTRY: ManualMarketEntry = {
  homeSpread: null,
  marketTotal: null,
  homeMoneyline: null,
  awayMoneyline: null,
};

/** Model-vs-market research comparison — explicitly not a guaranteed-EV claim, and never a staking unit. Every probability field here is EXPERIMENTAL and UNCALIBRATED (see model.ts's spreadCoverProbability/totalOverProbability docstrings) — a research number, not a validated edge. */
export interface ManualMarketComparison {
  spreadDiff: number | null; // model projected margin - entered home spread (as a "team must cover by" line, home perspective)
  totalDiff: number | null; // model projected total - entered market total
  /** De-vigged market win probability (home side), only when both moneylines are present. */
  marketHomeWinProb: number | null;
  marketAwayWinProb: number | null;
  /** model homeWinProb - marketHomeWinProb, only when both moneylines are present. */
  winProbDiff: number | null;
  /** Experimental, provisional spread-cover probability (model.ts's spreadCoverProbability) — only when a home spread is entered. */
  homeCoverProb: number | null;
  awayCoverProb: number | null;
  /** Experimental, provisional over/under probability (model.ts's totalOverProbability) — only when a market total is entered. */
  overProb: number | null;
  underProb: number | null;
}
