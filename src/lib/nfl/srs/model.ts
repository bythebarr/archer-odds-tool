/**
 * NFL SRS v0's prediction layer — turns two teams' opponent-adjusted ratings
 * (ratings.ts) into a scoreline, margin/total, and win probabilities. Pure
 * function, no I/O. Direct structural port of `src/lib/cfb/model.ts`.
 *
 * CONSTANT-FITTING RESULT (`npm run backtest:nfl:srs`, nflverse 2007+, n=4,951
 * graded games, 70/30 chronological train/validate split — the values below ARE
 * that script's fitted output, not a guess): the model IS calibration-honest
 * out of sample (OOS Brier 0.2456 vs. a base-rate guess's 0.2488 — real, if
 * modest, discrimination) but is **CLV-negative on both markets**: ATS -3.48%
 * ROI (vs. a flat-favorite -5.98% baseline — better than doing nothing, still a
 * clear loser against the close) and moneyline -9.36% ROI (WORSE than a flat
 * "always bet the favorite" baseline's -2.68%). The ATS edge-bucket breakdown
 * is also non-monotone (1-2pt -2.25%, 2-3pt -2.26%, 3-5pt -8.07%, 5+pt -1.62%)
 * — no clean "bigger edge, better ROI" gradient, the same shape every OTHER real
 * signal in this codebase is checked for and this one lacks.
 *
 * **Verdict: not wired.** This is directly comparable to (not meaningfully
 * better than, and worse on moneyline than) the existing Elo model's own
 * CLV-negative result (`npm run backtest:nfl:clv`: ATS -3.38% to -6.80%, ML
 * -7.97%) — an honest, structurally-different second attempt at the same
 * question, same negative answer. See `docs/architecture/nfl-srs-model.md` for
 * the full writeup. `nflAdapter.listPlays()` stays `[]`; this module is not
 * imported by production code. Kept, not deleted — same posture this codebase
 * already takes toward MLB's disabled bullpen-fatigue term and the shelved
 * props-matchup findings: a real, honestly-negative result is worth keeping on
 * record, and the underlying ratings/model code is sound infrastructure a
 * future feature set (QB-specific adjustments, injuries, rest) could build on.
 */
import type { NflConfidenceLevel, NflGamePrediction, NflPredictionDrivers, NflTeamRating } from "./types";

/** Home-field advantage, in total points added to the home side's projected score (split ±half). Fitted value: mean home margin (non-neutral games) over the train window — see this file's module docstring for the fit run. */
export const HOME_FIELD_POINTS = 2.257;

/** Standard deviation (points) used to convert a projected margin into a win probability via the normal CDF. Fitted value: stdev of (actual margin − projected margin) over the train window. */
export const MARGIN_SD = 14.54;

/** Standard deviation (points) used to convert a projected total into an over/under probability. Fitted value: stdev of (actual total − projected total) over the train window. */
export const TOTAL_SD = 13.99;

/** Below this many games for the *less-sampled* side, confidence reads "low" regardless of the projected edge — same thresholds as CFB's own. */
export const MIN_GAMES_LOW_CONFIDENCE = 3;
export const MIN_GAMES_HIGH_CONFIDENCE = 6;

/** Standard normal CDF via the Abramowitz-Stegun erf approximation — identical to CFB's own, deterministic, no external dependency. */
function normalCdf(x: number, sd: number): number {
  const z = x / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

function confidenceFor(minGames: number): NflConfidenceLevel {
  if (minGames < MIN_GAMES_LOW_CONFIDENCE) return "low";
  if (minGames < MIN_GAMES_HIGH_CONFIDENCE) return "medium";
  return "high";
}

/**
 * Projects one game from both teams' ratings. `leagueAvgPoints` must come from
 * the same `buildTeamRatings` call that produced `home`/`away` — and, if that
 * call used a non-default `homeFieldPoints`, `opts.homeFieldPoints` must match it
 * (see `ratings.ts`'s own parameter doc) so the HFA applied here is the same one
 * already baked into the ratings' opponent-adjustment. `opts.marginSd` overrides
 * `MARGIN_SD` for the same reason `spreadCoverProbability`/`totalOverProbability`
 * already accept an `sd` override — `scripts/fit-nfl-srs-constants.ts` needs to
 * evaluate candidate values without mutating module state.
 */
export function predictGame(
  home: NflTeamRating,
  away: NflTeamRating,
  leagueAvgPoints: number,
  opts: { neutralSite: boolean; homeFieldPoints?: number; marginSd?: number }
): NflGamePrediction {
  const homeFieldPoints = opts.homeFieldPoints ?? HOME_FIELD_POINTS;
  const hfaSplit = opts.neutralSite ? 0 : homeFieldPoints / 2;

  const projectedHomeScore = Math.max(0, leagueAvgPoints + home.offenseRating + away.defenseRating + hfaSplit);
  const projectedAwayScore = Math.max(0, leagueAvgPoints + away.offenseRating + home.defenseRating - hfaSplit);

  const projectedMargin = projectedHomeScore - projectedAwayScore;
  const projectedTotal = projectedHomeScore + projectedAwayScore;

  const homeWinProb = normalCdf(projectedMargin, opts.marginSd ?? MARGIN_SD);
  const awayWinProb = 1 - homeWinProb;

  const minGamesPlayed = Math.min(home.gamesPlayed, away.gamesPlayed);

  const drivers: NflPredictionDrivers = {
    offenseEdge: home.offenseRating - away.offenseRating,
    defenseEdge: away.defenseRating - home.defenseRating,
    scheduleStrengthEdge: home.strengthOfSchedule - away.strengthOfSchedule,
    homeFieldPoints: hfaSplit * 2,
    minGamesPlayed,
  };

  return {
    projectedHomeScore,
    projectedAwayScore,
    projectedMargin,
    projectedTotal,
    homeWinProb,
    awayWinProb,
    confidence: confidenceFor(minGamesPlayed),
    drivers,
  };
}

/**
 * Spread-cover probabilities against a home-perspective spread (positive = home
 * favored by that many points — matches nflverse's own `spread_line` convention,
 * see games.ts, which is the OPPOSITE sign convention from typical American-odds
 * notation and from CFB's `spreadCoverProbability` — home covers here exactly when
 * `actualMargin > homeSpread`, no negation needed). Same Normal(projectedMargin,
 * MARGIN_SD) approach as CFB's version; same "push" simplification caveat (a
 * continuous distribution can't represent one exactly, an honest approximation for
 * a half-point-heavy real market).
 */
export function spreadCoverProbability(
  projectedMargin: number,
  homeSpread: number,
  sd: number = MARGIN_SD
): { homeCoverProb: number; awayCoverProb: number } {
  const homeCoverProb = 1 - normalCdf(homeSpread - projectedMargin, sd);
  return { homeCoverProb, awayCoverProb: 1 - homeCoverProb };
}

/** Over/under probabilities against a market total. Models the actual total as Normal(projectedTotal, TOTAL_SD) — same shape as CFB's `totalOverProbability`. */
export function totalOverProbability(
  projectedTotal: number,
  marketTotal: number,
  sd: number = TOTAL_SD
): { overProb: number; underProb: number } {
  const overProb = 1 - normalCdf(marketTotal - projectedTotal, sd);
  return { overProb, underProb: 1 - overProb };
}
