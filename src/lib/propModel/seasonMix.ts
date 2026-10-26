/**
 * How much of a projection came from this season vs last — shown on every
 * projection so early-season numbers are honest about leaning on last year.
 *
 * Projections weight games by recency and shrink toward a longer baseline;
 * whatever the scheme, it reduces to a weight per logged game. This sums those
 * weights by season.
 */
export interface SeasonMix {
  current: { games: number; avg: number | null };
  last: { games: number; avg: number | null };
  /** Share of the projection's weight on last season's games (0–1). */
  lastShare: number;
}

export function seasonMix<L extends { season: number }>(
  logs: L[],
  weights: number[],
  season: number,
  value: (l: L) => number
): SeasonMix {
  const cur = logs.filter((l) => l.season === season);
  const last = logs.filter((l) => l.season === season - 1);
  const avg = (g: L[]) => (g.length ? g.reduce((a, l) => a + value(l), 0) / g.length : null);
  let total = 0;
  let lastW = 0;
  logs.forEach((l, i) => {
    const w = weights[i] ?? 0;
    total += w;
    if (l.season !== season) lastW += w;
  });
  return { current: { games: cur.length, avg: avg(cur) }, last: { games: last.length, avg: avg(last) }, lastShare: total ? lastW / total : 0 };
}
