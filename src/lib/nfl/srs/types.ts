/**
 * NFL SRS v0 — shared types for the opponent-adjusted points model. Deliberately
 * mirrors `src/lib/cfb/types.ts`'s rating/prediction shapes so the two models stay
 * structurally comparable (see this module's own `ratings.ts`/`model.ts` docstrings
 * for what's reused as-is vs. genuinely NFL-specific). Unlike CFB v0, this model is
 * NOT tied to a schedule-fetching layer of its own — `historicalGames.ts` adapts the
 * existing `src/lib/nfl/games.ts` (nflverse) feed into `NflCompletedGame`, so a future
 * production data source (the already-live `Game`/`GameOutcome` Prisma tables) could
 * feed the same ratings/model code via its own adapter without touching this file.
 */

/** One completed game, already reduced to what the rating solver needs. Team ids are nflverse's own team codes (e.g. "KC", "BUF") — the same identifiers `src/lib/nfl/elo.ts`/`teams.ts` already use, so this model's output is directly comparable/joinable with the existing Elo model's. */
export interface NflCompletedGame {
  /** nflverse's own game id (e.g. "1999_01_MIN_ATL") — the dedup/join key. */
  gameId: string;
  startUtc: Date;
  /** True for the handful of games per season played at neither team's home stadium — international games and the Super Bowl (excluded from ratings anyway in v1, see historicalGames.ts, but kept honest here). */
  neutralSite: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

/** Confidence in a team's rating, driven mainly by sample size — same three-bucket shape as CFB's `CfbConfidenceLevel`. */
export type NflConfidenceLevel = "low" | "medium" | "high";

/** Output of `buildTeamRatings`: per-team ratings plus the league-average points figure they're relative to — `model.ts` needs the same number back to reconstruct actual projected scores from "points above average" ratings. */
export interface NflRatingBook {
  ratings: Map<string, NflTeamRating>;
  leagueAvgPoints: number;
}

/** One team's opponent-adjusted rating as of a given cutoff. */
export interface NflTeamRating {
  teamId: string;
  /** Points above league average this team scores, opponent-adjusted, shrunk for sample size. */
  offenseRating: number;
  /** Points above league average this team allows, opponent-adjusted, shrunk for sample size (negative = stingier than average). */
  defenseRating: number;
  /** offenseRating - defenseRating; the single-number net strength used for the win-prob model. */
  netRating: number;
  gamesPlayed: number;
  /** Average net rating of opponents actually faced so far. */
  strengthOfSchedule: number;
}

/** Named, human-readable driver values — presentation data, computed by the model so any future UI carries zero model logic, same role as CFB's `CfbPredictionDrivers`. */
export interface NflPredictionDrivers {
  offenseEdge: number; // home offenseRating - away offenseRating
  defenseEdge: number; // away defenseRating - home defenseRating (positive favors home)
  scheduleStrengthEdge: number; // home SOS - away SOS
  homeFieldPoints: number; // 0 when neutral
  minGamesPlayed: number; // the smaller of the two teams' sample sizes
}

/** One game's model output. Carries the same "not yet proven" framing as CFB v0 until Phase B's CLV backtest says otherwise — see ratings.ts/model.ts module docstrings. */
export interface NflGamePrediction {
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedMargin: number; // home - away
  projectedTotal: number;
  homeWinProb: number;
  awayWinProb: number; // 1 - homeWinProb, always
  confidence: NflConfidenceLevel;
  drivers: NflPredictionDrivers;
}
