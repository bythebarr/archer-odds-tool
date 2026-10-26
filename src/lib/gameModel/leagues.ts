/**
 * Each league's game-model constants. Starting values come from public
 * research (sources in docs/architecture/MODEL-FRAMEWORK.md); the ratings
 * learn the league average and home edge as they go, and `npm run
 * backtest:games` refits k and both spreads on our own history and saves them
 * — the live model reads the fitted spreads once a fit has enough games.
 */
import type { KeyNumbers } from "./scoreDist";
import type { RatingOpts } from "./ratings";

export interface GameModelLeague {
  sport: "nba" | "nfl";
  ratings: RatingOpts;
  /** Final margin's spread around the model's expectation. */
  marginSd: number;
  /** Final total's spread around the model's expectation. */
  totalSd: number;
  keyNumbers?: KeyNumbers;
  ties: boolean;
  /** Games each team needs before its rating prices anything. */
  minGames: number;
}

export const NBA_GAME_MODEL: GameModelLeague = {
  sport: "nba",
  // Home edge ~3 pts in older data and smaller since 2020; learned from 2.5.
  ratings: { k: 0.06, revert: 0.3, hfa: 2.5, leagueAvg: 114, driftK: 0.002 },
  marginSd: 12,
  totalSd: 18,
  ties: false,
  minGames: 8,
};

/**
 * |margin| frequencies, 1999–2025 (3 ≈ 15%, 7 ≈ 9%, 10 ≈ 6%, 6 ≈ 6% since the
 * 2015 extra-point change, 4 ≈ 5%, 14 ≈ 4.6%). 1, 2, 5 and 8 are rougher.
 */
export const NFL_KEY_NUMBERS: KeyNumbers = {
  0: 0.003,
  1: 0.035,
  2: 0.035,
  3: 0.15,
  4: 0.05,
  5: 0.035,
  6: 0.06,
  7: 0.09,
  8: 0.045,
  10: 0.06,
  14: 0.046,
};

export const NFL_GAME_MODEL: GameModelLeague = {
  sport: "nfl",
  ratings: { k: 0.1, revert: 0.33, hfa: 1.8, leagueAvg: 22.5, driftK: 0.003 },
  marginSd: 13.5,
  totalSd: 13.5,
  keyNumbers: NFL_KEY_NUMBERS,
  ties: true,
  minGames: 4,
};

export const GAME_MODEL_BY_SPORT = { nba: NBA_GAME_MODEL, nfl: NFL_GAME_MODEL } as const;
