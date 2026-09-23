/**
 * Opponent-adjusted, shrunken, strictly as-of team ratings on any per-play
 * efficiency metric (EPA/play, success rate, pass EPA, rush EPA, …). Pure.
 *
 * Model, per (game, offense) observation with `n` neutral plays and mean `v`:
 *
 *     v ≈ μ + off[offense] + def[defense]
 *
 * solved by weighted ridge (alternating coordinate updates), where each team's
 * rating is pulled toward a prior with strength `k` phantom plays:
 *
 *     off[t] = (Σ n·(v − μ − def[d]) + k·prior_off[t]) / (Σ n + k)
 *
 * The prior is last season's final rating × `carry` (regression to the mean
 * between seasons). Both `k` and `carry` are fit on the train window only, by
 * predicting each held-out team-game's value from ratings built strictly
 * before it — market-blind, so the fit cannot leak the closing line.
 *
 * As-of rule (docs/architecture/NFL-PBP-FEASIBILITY.md): a rating for a game
 * uses only observations with `gameDate < cutoff`, where `cutoff` is the
 * earliest game date of that game's NFL week, and only its own season's
 * observations plus the previous season's (itself as-of-season-end) prior.
 */
import type { TeamGameObs } from "./teamGames";

export interface Metric {
  name: string;
  /** [sum, count] of the metric for this observation — mean = sum / count. */
  of: (o: TeamGameObs) => [number, number];
}

export const METRICS = {
  epa: { name: "epa", of: (o) => [o.epa, o.plays] },
  success: { name: "success", of: (o) => [o.success, o.plays] },
  passEpa: { name: "passEpa", of: (o) => [o.passEpa, o.passPlays] },
  rushEpa: { name: "rushEpa", of: (o) => [o.rushEpa, o.rushPlays] },
  sackRate: { name: "sackRate", of: (o) => [o.sacks, o.dropbacks] },
  earlyDownPassRate: { name: "earlyDownPassRate", of: (o) => [o.earlyDownPasses, o.earlyDownPlays] },
  explosiveRate: { name: "explosiveRate", of: (o) => [o.explosives, o.plays] },
} satisfies Record<string, Metric>;

export interface RatingParams {
  /** Prior strength, in phantom plays. */
  k: number;
  /** Fraction of last season's final rating carried into this season's prior. */
  carry: number;
}

export interface Ratings {
  mu: number;
  off: Map<string, number>;
  def: Map<string, number>;
}

const ITERATIONS = 25;

interface Row {
  off: string;
  def: string;
  v: number;
  n: number;
}

function toRows(obs: readonly TeamGameObs[], metric: Metric): Row[] {
  const rows: Row[] = [];
  for (const o of obs) {
    const [sum, n] = metric.of(o);
    if (n > 0) rows.push({ off: o.off, def: o.def, v: sum / n, n });
  }
  return rows;
}

export function solveRatings(
  rows: readonly Row[],
  prior: Ratings | null,
  params: RatingParams,
  fallbackMu: number
): Ratings {
  let wsum = 0;
  let vsum = 0;
  for (const r of rows) {
    wsum += r.n;
    vsum += r.n * r.v;
  }
  const mu = wsum > 0 ? vsum / wsum : fallbackMu;
  const priorOff = (t: string) => params.carry * (prior?.off.get(t) ?? 0);
  const priorDef = (t: string) => params.carry * (prior?.def.get(t) ?? 0);

  const teams = new Set<string>();
  for (const r of rows) {
    teams.add(r.off);
    teams.add(r.def);
  }
  if (prior) for (const t of prior.off.keys()) teams.add(t);

  const off = new Map<string, number>();
  const def = new Map<string, number>();
  for (const t of teams) {
    off.set(t, priorOff(t));
    def.set(t, priorDef(t));
  }
  const byOff = new Map<string, Row[]>();
  const byDef = new Map<string, Row[]>();
  for (const r of rows) {
    (byOff.get(r.off) ?? byOff.set(r.off, []).get(r.off)!).push(r);
    (byDef.get(r.def) ?? byDef.set(r.def, []).get(r.def)!).push(r);
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (const t of teams) {
      let num = params.k * priorOff(t);
      let den = params.k;
      for (const r of byOff.get(t) ?? []) {
        num += r.n * (r.v - mu - def.get(r.def)!);
        den += r.n;
      }
      off.set(t, den > 0 ? num / den : 0);
    }
    for (const t of teams) {
      let num = params.k * priorDef(t);
      let den = params.k;
      for (const r of byDef.get(t) ?? []) {
        num += r.n * (r.v - mu - off.get(r.off)!);
        den += r.n;
      }
      def.set(t, den > 0 ? num / den : 0);
    }
  }
  return { mu, off, def };
}

/**
 * Memoized as-of ratings for one metric. Season finals chain forward (each
 * season's prior is the previous season's final × carry); `asOf` solves the
 * current season's observations strictly before an ISO-date cutoff.
 */
export class AsOfRatingBook {
  private readonly finals = new Map<number, Ratings>();
  private readonly cache = new Map<string, Ratings>();
  private readonly seasonObs = new Map<number, TeamGameObs[]>();

  constructor(
    obs: readonly TeamGameObs[],
    private readonly metric: Metric,
    private readonly params: RatingParams
  ) {
    for (const o of obs) {
      const list = this.seasonObs.get(o.season) ?? [];
      list.push(o);
      this.seasonObs.set(o.season, list);
    }
  }

  private seasonFinal(season: number): Ratings | null {
    if (!this.seasonObs.has(season)) return null;
    const hit = this.finals.get(season);
    if (hit) return hit;
    const prior = this.seasonFinal(season - 1);
    const r = solveRatings(toRows(this.seasonObs.get(season)!, this.metric), prior, this.params, prior?.mu ?? 0);
    this.finals.set(season, r);
    return r;
  }

  /** Ratings for games of `season` whose week starts on `cutoff` (exclusive). */
  asOf(season: number, cutoff: string): Ratings {
    const key = `${season}|${cutoff}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const prior = this.seasonFinal(season - 1);
    const current = (this.seasonObs.get(season) ?? []).filter((o) => o.gameDate < cutoff);
    const r = solveRatings(toRows(current, this.metric), prior, this.params, prior?.mu ?? 0);
    this.cache.set(key, r);
    return r;
  }
}

/** Expected value of `metric` when `off` has the ball against `def`. */
export function expectedValue(r: Ratings, off: string, def: string): number {
  return r.mu + (r.off.get(off) ?? 0) + (r.def.get(def) ?? 0);
}
