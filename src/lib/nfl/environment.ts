/**
 * This week's game environment for an NFL prop, from the game lines:
 *
 * - Volume: the team's implied points ((total − spread) / 2) against what it
 *   usually scores. More expected points means more plays, more yards and
 *   especially more touchdowns.
 * - Script: the spread from the team's side. Underdogs trail and throw;
 *   favorites lead and run the clock. Passing and receiving volume rise with
 *   the spread, rushing volume falls.
 *
 * Priors, capped; `npm run backtest:nfl-props` reports projection error with
 * and without them.
 */
import type { NflPropStat } from "@/generated/prisma/client";
import { elasticFactor, impliedTeamTotal, teamSpread, type GameLines } from "@/lib/propModel/environment";

/** How each stat moves with the team's implied points (1 = proportionally). */
const VOLUME_ELASTICITY: Record<NflPropStat, number> = {
  anytimeTd: 0.9,
  passTds: 0.9,
  passYards: 0.5,
  rushYards: 0.45,
  recYards: 0.5,
  rushRecYards: 0.5,
  receptions: 0.3,
  passCompletions: 0.3,
  passAttempts: 0.15,
  rushAttempts: 0.35,
  interceptions: 0,
  longestRush: 0.2,
  longestReception: 0.2,
  kickingPoints: 0.6,
  fieldGoals: 0.4,
  extraPoints: 0.9,
  sacks: 0,
  soloTackles: 0,
  tacklesAssists: 0,
};
const VOLUME_CAP = 0.15;

/** Per point of spread (positive = underdog): pass volume up, run volume down. */
const SCRIPT_SLOPE: Record<NflPropStat, number> = {
  passAttempts: 0.008,
  passCompletions: 0.007,
  passYards: 0.006,
  interceptions: 0.008,
  receptions: 0.005,
  recYards: 0.005,
  rushAttempts: -0.01,
  rushYards: -0.009,
  rushRecYards: -0.003,
  passTds: 0,
  anytimeTd: 0,
  longestRush: -0.004,
  longestReception: 0.003,
  kickingPoints: 0,
  fieldGoals: 0,
  extraPoints: 0,
  sacks: 0,
  soloTackles: 0,
  tacklesAssists: 0,
};
const SCRIPT_CAP = 0.08;

/** A typical NFL team's points per game, when a team's own history is thin. */
export const NFL_AVG_TEAM_POINTS = 22.5;

export interface NflEnvironment {
  volumeFactor: number;
  scriptFactor: number;
  impliedPoints: number | null;
  spread: number | null;
}

export const NEUTRAL_NFL_ENV: NflEnvironment = { volumeFactor: 1, scriptFactor: 1, impliedPoints: null, spread: null };

/** `baselinePoints`: what the team usually scores, so volume is this week vs its normal. */
export function nflEnvironment(lines: GameLines, isHome: boolean | null, stat: NflPropStat, baselinePoints: number | null): NflEnvironment {
  if (isHome === null) return NEUTRAL_NFL_ENV;
  const implied = impliedTeamTotal(lines, isHome);
  const spread = teamSpread(lines, isHome);
  // A team's own scoring when it looks real; the league norm otherwise.
  const base = baselinePoints !== null && baselinePoints >= 10 && baselinePoints <= 40 ? baselinePoints : NFL_AVG_TEAM_POINTS;
  const volumeFactor = implied !== null && base > 0 ? elasticFactor(implied / base, VOLUME_ELASTICITY[stat], VOLUME_CAP) : 1;
  const scriptFactor = spread !== null ? Math.min(1 + SCRIPT_CAP, Math.max(1 - SCRIPT_CAP, 1 + SCRIPT_SLOPE[stat] * spread)) : 1;
  return { volumeFactor, scriptFactor, impliedPoints: implied, spread };
}
