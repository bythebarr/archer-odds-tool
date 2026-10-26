/**
 * The game environment from the books' own game lines — the number every prop
 * desk starts from. A total says how many points (so possessions, plays and
 * shots) the market expects; a spread says who leads, which drives garbage
 * time in basketball and the pass/run mix in football.
 *
 * Each sport turns these into factors on its projection (see
 * nba/environment.ts, nfl/environment.ts). The coefficients there are priors
 * from public research, regressed and capped; the props backtests report
 * projection error with and without them so they can be refit.
 */

export interface GameLines {
  /** Home team's spread (negative = home favored), consensus across books. */
  homeSpread: number | null;
  /** Game total, consensus across books. */
  total: number | null;
}

export const NO_LINES: GameLines = { homeSpread: null, total: null };

/** A team's spread from its own side: positive = underdog. */
export function teamSpread(lines: GameLines, isHome: boolean): number | null {
  if (lines.homeSpread === null) return null;
  return isHome ? lines.homeSpread : -lines.homeSpread;
}

/** Points the market expects a team to score: (total − its spread) / 2. */
export function impliedTeamTotal(lines: GameLines, isHome: boolean): number | null {
  const s = teamSpread(lines, isHome);
  if (lines.total === null || s === null) return null;
  return (lines.total - s) / 2;
}

/** 1 + elasticity × (ratio − 1), capped to ±cap — how a stat moves with its environment. */
export function elasticFactor(ratio: number, elasticity: number, cap: number): number {
  const f = 1 + (ratio - 1) * elasticity;
  return Math.min(1 + cap, Math.max(1 - cap, f));
}

/** The most common number among books (ties → the smaller magnitude), for consensus lines. */
export function modeNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0];
}
