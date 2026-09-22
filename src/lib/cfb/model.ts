/**
 * CFB v0's prediction layer — turns two teams' opponent-adjusted ratings
 * (ratings.ts) into a scoreline, margin/total, and win probabilities. Pure
 * function, no I/O. Every constant below is named and explicitly heuristic:
 * none of them have been fit to historical CFB results yet (that's the
 * roadmap in docs/architecture/CFB-V0.md, not v0). Nothing here is described
 * as calibrated, and nothing here computes a staking unit.
 */
import type { CfbConfidenceLevel, CfbGamePrediction, CfbPredictionDrivers, CfbTeamRating } from "./types";

/**
 * Home-field advantage, in total points added to the home side's projected
 * score (split ±half between the two teams — see below). ~2 points reflects
 * modern era estimates being smaller than older rules of thumb (same
 * rationale nfl/elo.ts documents for its HFA constant). PROVISIONAL: not
 * fit to CFB history yet.
 */
export const HOME_FIELD_POINTS = 2;

/**
 * Standard deviation (points) used to convert a projected margin into a win
 * probability via the normal CDF. 17 points is a commonly-cited rough figure
 * for college-football game-margin spread — PROVISIONAL and explicitly
 * heuristic, not fit to this model's own history. Replace once
 * `npm run backtest:cfb` (roadmap) exists.
 */
export const MARGIN_SD = 17;

/**
 * Standard deviation (points) used to convert a projected total into an
 * over/under probability against a manually-entered market total, via the
 * same normal-CDF approach as `MARGIN_SD`. 16 points is a rough, PROVISIONAL
 * placeholder in the same spirit as `MARGIN_SD` — not fit to this model's own
 * results, and deliberately a separate constant from `MARGIN_SD` since a
 * total's variance isn't the same statistical quantity as a margin's.
 */
export const TOTAL_SD = 16;

/** Below this many games for the *less-sampled* side, confidence reads "low" regardless of the projected edge. */
export const MIN_GAMES_LOW_CONFIDENCE = 3;
/** At or above this many games for the less-sampled side, confidence reads "high". Between the two thresholds: "medium". */
export const MIN_GAMES_HIGH_CONFIDENCE = 6;

/** Standard normal CDF via the Abramowitz-Stegun erf approximation — deterministic, no external dependency. */
function normalCdf(x: number, sd: number): number {
  const z = x / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

function confidenceFor(minGames: number): CfbConfidenceLevel {
  if (minGames < MIN_GAMES_LOW_CONFIDENCE) return "low";
  if (minGames < MIN_GAMES_HIGH_CONFIDENCE) return "medium";
  return "high";
}

/**
 * Projects one game from both teams' ratings. `leagueAvgPoints` must come
 * from the same `buildTeamRatings` call that produced `home`/`away` (see
 * `CfbRatingBook`), so the ratings' "points above average" units line up
 * with the actual scoreline being reconstructed here.
 */
export function predictGame(
  home: CfbTeamRating,
  away: CfbTeamRating,
  leagueAvgPoints: number,
  opts: { neutralSite: boolean }
): CfbGamePrediction {
  const hfaSplit = opts.neutralSite ? 0 : HOME_FIELD_POINTS / 2;

  // A team can't score negative points; clamp before deriving margin/total so
  // the three numbers stay exactly consistent (margin = home - away, total =
  // home + away) even for an extreme synthetic rating gap.
  const projectedHomeScore = Math.max(0, leagueAvgPoints + home.offenseRating + away.defenseRating + hfaSplit);
  const projectedAwayScore = Math.max(0, leagueAvgPoints + away.offenseRating + home.defenseRating - hfaSplit);

  const projectedMargin = projectedHomeScore - projectedAwayScore;
  const projectedTotal = projectedHomeScore + projectedAwayScore;

  const homeWinProb = normalCdf(projectedMargin, MARGIN_SD);
  const awayWinProb = 1 - homeWinProb; // never computed independently, so the pair always sums to exactly 1

  const minGamesPlayed = Math.min(home.gamesPlayed, away.gamesPlayed);

  const drivers: CfbPredictionDrivers = {
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
 * Experimental, provisional spread-cover probabilities against a manually
 * entered home-perspective spread (e.g. -3.5 = home favored by 3.5 — see
 * `manualMarket.ts`'s docstring for the sign convention). Models the actual
 * margin as Normal(projectedMargin, MARGIN_SD) — the same distributional
 * assumption `predictGame`'s win probability already uses — and asks what
 * fraction of that distribution clears the entered line.
 *
 * `homeCoverProb + awayCoverProb` is always exactly 1 (the away side is
 * `1 - home`, never computed independently). A continuous normal distribution
 * has zero probability mass at any single point, so this treats a "push"
 * (landing exactly on the line) as vanishingly unlikely rather than modeling
 * it explicitly — an honest simplification for an integer-valued real spread,
 * not a claim that pushes can't happen.
 */
export function spreadCoverProbability(
  projectedMargin: number,
  homeSpread: number,
  sd: number = MARGIN_SD
): { homeCoverProb: number; awayCoverProb: number } {
  const homeCoverProb = 1 - normalCdf(-homeSpread - projectedMargin, sd);
  return { homeCoverProb, awayCoverProb: 1 - homeCoverProb };
}

/**
 * Experimental, provisional over/under probabilities against a manually
 * entered market total. Models the actual total as
 * Normal(projectedTotal, TOTAL_SD). Same push caveat as `spreadCoverProbability`
 * above: a continuous model can't represent a nonzero push probability at an
 * integer total.
 */
export function totalOverProbability(
  projectedTotal: number,
  marketTotal: number,
  sd: number = TOTAL_SD
): { overProb: number; underProb: number } {
  const overProb = 1 - normalCdf(marketTotal - projectedTotal, sd);
  return { overProb, underProb: 1 - overProb };
}
