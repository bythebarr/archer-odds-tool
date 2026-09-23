/**
 * Touchdown props: anytime TD (rushing + receiving) and passing TDs. Pure.
 *
 *   team TDs (proj)  = a + b·(market-implied team points) + c·(team's recent TDs/game)
 *   anytime λ        = team TDs × player TD share
 *   player TD share  = shrink(player's decayed TDs, team TDs in his games,
 *                             prior = αcar·carry share + αtgt·target share, k)
 *   passing TD λ     = team TDs × team pass-TD fraction (shrunk) × QB attempt share
 *
 * The role prior is the point: TDs are rare and noisy, so a player's own TD
 * history gets shrunk hard toward what his carry/target role implies.
 * Implied team points = total/2 + (team spread)/2 — the pregame market line,
 * the same context the volume model already uses. Counts are Poisson.
 */
import type { Snapshot } from "./engine";
import type { Components } from "./model";

export const TD_MARKETS = ["anytimeTd", "passingTds"] as const;
export type TdMarket = (typeof TD_MARKETS)[number];

export function isTdMarket(m: string): m is TdMarket {
  return (TD_MARKETS as readonly string[]).includes(m);
}

export interface TdParams {
  /** [intercept, implied team points, team recent TDs/game]. */
  teamTd: [number, number, number];
  alphaCar: number;
  alphaTgt: number;
  /** Prior strength for a player's TD share, in phantom team TDs. */
  kTd: number;
  /** Prior strength for a team's pass-TD fraction, in phantom team TDs. */
  kPassFrac: number;
}

const DEFAULT_IMPLIED = 22;

export function impliedTeamPoints(s: Snapshot): number {
  if (s.total === null || s.teamSpread === null) return DEFAULT_IMPLIED;
  return s.total / 2 + s.teamSpread / 2;
}

export function teamTdFeatures(team: Snapshot): number[] {
  const recent = (team.team.td + team.league.teamTd) / (team.team.games + 1);
  return [1, impliedTeamPoints(team), recent];
}

export function projectTeamTds(team: Snapshot, p: TdParams): number {
  const x = teamTdFeatures(team);
  return Math.max(0.3, p.teamTd[0] * x[0] + p.teamTd[1] * x[1] + p.teamTd[2] * x[2]);
}

export function tdShare(tdSnap: Snapshot, c: Pick<Components, "carShare" | "tgtShare">, p: Pick<TdParams, "alphaCar" | "alphaTgt" | "kTd">): number {
  const prior = Math.max(0, p.alphaCar * c.carShare + p.alphaTgt * c.tgtShare);
  return (tdSnap.player.td + p.kTd * prior) / (tdSnap.player.teamTd + p.kTd);
}

export function passTdFraction(team: Snapshot, kPassFrac: number): number {
  return (team.team.passTd + kPassFrac * team.league.passTdFrac) / (team.team.td + kPassFrac);
}

export function anytimeLambda(teamTds: number, share: number): number {
  return teamTds * share;
}

export function passTdLambda(teamTds: number, passFrac: number, attShare: number): number {
  return teamTds * passFrac * attShare;
}

/** P(X > line) for X ~ Poisson(λ). */
export function poissonOver(lambda: number, line: number): number {
  const kMax = Math.floor(line);
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let k = 1; k <= kMax; k++) {
    term *= lambda / k;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}
