/**
 * ARCHR's NBA prop projection: what a player should produce tonight and the
 * chance he clears any line — client-safe and pure, so the finder re-prices
 * every line instantly, like the hit rates.
 *
 *   mean = expected minutes × per-minute rate × matchup × pace
 *
 * - Minutes: recency-weighted over the last 20 games (half-life 5) — rotation
 *   changes show up fast.
 * - Per-minute rate: recency-weighted over the last 30 (half-life 10), shrunk
 *   toward the player's two-season rate so a hot week doesn't run away with it.
 * - Matchup: what the opponent allows to the player's position (or team-wide)
 *   against the league, half-regressed and capped — defensive effects are real
 *   but noisy.
 * - Game environment (nba/environment.ts): tonight's total against his
 *   team's normal scales production, and the spread trims starters' minutes
 *   in likely blowouts. With no lines posted, the opponent's pace (combined
 *   points against the league) stands in for the total.
 *
 * Early in a season most of the weight sits on last season's games — the
 * projection reports that split (seasonMix) so the panel can say so.
 *
 * The chance of clearing a line comes from a negative binomial with the
 * projection as its mean and the player's own game-to-game spread in this stat
 * (never tighter than Poisson): counts, over-dispersed, right-skewed — how box
 * score stats actually fall. A final logit shrink (CALIBRATION_SHRINK) pulls
 * probabilities toward 50% until `npm run backtest:nba-props` says otherwise;
 * the props pipeline (propModel/price.ts) then blends that with the market.
 */
import type { GameLogPoint } from "./propsMath";
import type { NbaPropStatDef } from "./propStats";
import type { DefenseTable } from "./matchup";
import { statMatchup, paceRank } from "./matchup";
import type { PositionGroup } from "./positionGroups";
import { gamesWithout, withoutWeight, type Absence } from "@/lib/injuries/absence";
import { countCdf, rawProbOver, shrinkLogit, type StatDistribution } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { seasonMix, type SeasonMix } from "@/lib/propModel/seasonMix";
import { nbaEnvironment, type NbaEnvironment } from "./environment";

export { countCdf };

const MINUTES_WINDOW = 20;
const MINUTES_HALF_LIFE = 5;
const RATE_WINDOW = 30;
const RATE_HALF_LIFE = 10;
/** Weight (in games) of the two-season rate the recent rate is shrunk toward. */
const RATE_PRIOR_GAMES = 8;
/** Games needed before projecting at all. */
export const MIN_GAMES = 5;

const MATCHUP_REGRESSION = 0.5;
const MATCHUP_CAP = 0.12;
const PACE_REGRESSION = 0.5;
const PACE_CAP = 0.05;

/**
 * Pulls the model's probabilities toward 50% in logit space. 1 = trust as is.
 * Starts conservative; refit with the backtest once enough history is logged.
 */
export const CALIBRATION_SHRINK = 0.8;

export interface PropProjection {
  mean: number;
  /** Standard deviation of the stat around the mean. */
  sd: number;
  minutes: number;
  perMinute: number;
  matchupFactor: number;
  paceFactor: number;
  games: number;
  /** When rotation teammates are out: the games without them that were blended in. */
  absence: { names: string[]; games: number; minutes: number; perMinute: number } | null;
  /** Game total and blowout adjustments from tonight's lines (neutral without them). */
  env: NbaEnvironment;
  /** How much of the per-minute rate rests on this season vs last. */
  seasons: SeasonMix;
  distribution: StatDistribution;
}

/** The full-history estimate counts as this many games against the without-teammate games. */
const ABSENCE_PRIOR_GAMES = 5;
const MIN_WITHOUT_GAMES = 2;

function weighted(values: number[], halfLife: number): { mean: number; weight: number } {
  let sum = 0;
  let w = 0;
  values.forEach((v, i) => {
    const wi = Math.pow(0.5, i / halfLife);
    sum += v * wi;
    w += wi;
  });
  return { mean: w ? sum / w : 0, weight: w };
}

function factor(ratio: number, regression: number, cap: number): number {
  const f = 1 + (ratio - 1) * (1 - regression);
  return Math.min(1 + cap, Math.max(1 - cap, f));
}

export interface ProjectionContext {
  defense: DefenseTable;
  opponent: string | null;
  positionGroup: PositionGroup | null;
  /** Rotation teammates out tonight (see injuries/absence). */
  absences?: Absence[];
  /** Tonight's consensus spread and total. */
  lines?: GameLines;
  /** His side tonight; null when unknown (the spread can't be read). */
  isHome?: boolean | null;
  /** His team's average combined score — the environment his logs were played in. */
  baselineTotal?: number | null;
  /** Tonight's season, for the season mix (default: his latest game's). */
  season?: number;
}

/** Projects one stat for one player from his logs (most recent first). Null with fewer than MIN_GAMES. */
export function projectProp(logs: GameLogPoint[], stat: NbaPropStatDef, ctx: ProjectionContext): PropProjection | null {
  const played = logs.filter((l) => l.minutes > 0);
  if (played.length < MIN_GAMES) return null;

  const minutes = weighted(played.slice(0, MINUTES_WINDOW).map((l) => l.minutes), MINUTES_HALF_LIFE).mean;

  const recent = played.slice(0, RATE_WINDOW);
  const decay = recent.map((l, i) => Math.pow(0.5, i / RATE_HALF_LIFE) * l.minutes);
  const decayMinutes = decay.reduce((a, b) => a + b, 0);
  const recentRate = decayMinutes ? recent.reduce((a, l, i) => a + (stat.value(l) * decay[i]) / l.minutes, 0) / decayMinutes : 0;
  const totalMinutes = played.reduce((a, l) => a + l.minutes, 0);
  const longRate = totalMinutes ? played.reduce((a, l) => a + stat.value(l), 0) / totalMinutes : 0;
  const recentWeight = Math.min(recent.length, RATE_WINDOW);
  const recentShare = recentWeight / (recentWeight + RATE_PRIOR_GAMES);
  let perMinute = recentRate * recentShare + longRate * (1 - recentShare);
  // Each game's pull on the rate: its share of the recency-weighted part plus its share of the long baseline.
  const gameWeights = played.map(
    (l, i) =>
      (i < recent.length && decayMinutes ? (recentShare * decay[i]) / decayMinutes : 0) +
      (totalMinutes ? ((1 - recentShare) * l.minutes) / totalMinutes : 0)
  );
  const seasons = seasonMix(played, gameWeights, ctx.season ?? played[0].season, stat.value);
  let minutesAdj = minutes;

  // Teammates out tonight: lean on the games he's already played without them.
  let absence: PropProjection["absence"] = null;
  const without = ctx.absences?.length ? gamesWithout(played, ctx.absences) : [];
  if (without.length >= MIN_WITHOUT_GAMES) {
    const wMin = without.reduce((a, l) => a + l.minutes, 0);
    const wMinutes = wMin / without.length;
    const wRate = wMin ? without.reduce((a, l) => a + stat.value(l), 0) / wMin : perMinute;
    const w = withoutWeight(without.length, ABSENCE_PRIOR_GAMES);
    minutesAdj = minutes * (1 - w) + wMinutes * w;
    perMinute = perMinute * (1 - w) + wRate * w;
    absence = { names: ctx.absences!.map((a) => a.name), games: without.length, minutes: wMinutes, perMinute: wRate };
  }

  const env = nbaEnvironment(ctx.lines ?? NO_LINES, ctx.isHome ?? null, stat.key, minutesAdj, ctx.baselineTotal ?? null);
  minutesAdj *= env.minutesFactor;

  let matchupFactor = 1;
  let paceFactor = 1;
  if (ctx.opponent) {
    const m = statMatchup(ctx.defense, ctx.opponent, stat, ctx.positionGroup);
    if (m && m.leagueAvg > 0) matchupFactor = factor(m.perGame / m.leagueAvg, MATCHUP_REGRESSION, MATCHUP_CAP);
    // The posted total already prices both teams' pace; the opponent's pace only stands in without it.
    if (env.total === null) {
      const p = paceRank(ctx.defense, ctx.opponent);
      const all = Object.values(ctx.defense.teams).map((t) => t.combinedPoints);
      const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
      if (p && avg > 0) paceFactor = factor(p.combinedPoints / avg, PACE_REGRESSION, PACE_CAP);
    }
  }

  const mean = minutesAdj * perMinute * matchupFactor * paceFactor * env.totalFactor;

  // Spread: the player's own game-to-game variance in this stat (last 20),
  // scaled to tonight's mean, never below Poisson.
  const sample = played.slice(0, 20).map((l) => stat.value(l));
  const sMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sVar = sample.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(sample.length - 1, 1);
  const dispersion = sMean > 0 ? sVar / sMean : 1; // variance per unit of mean
  const variance = Math.max(mean, mean * Math.max(dispersion, 1));

  return {
    mean,
    sd: Math.sqrt(variance),
    minutes: minutesAdj,
    perMinute,
    matchupFactor,
    paceFactor,
    games: played.length,
    absence,
    env,
    seasons,
    distribution: { kind: "count", mean, variance },
  };
}

/** The model's uncalibrated chance the Over cashes at `point` (pushes refund). */
export function rawOver(proj: PropProjection, point: number): number {
  return rawProbOver(proj.distribution, point);
}

/**
 * The model's chance the Over cashes at `point` (strictly more than the line;
 * on a whole number a push is neither side). Calibrated by CALIBRATION_SHRINK.
 */
export function probOver(proj: PropProjection, point: number): number {
  return shrinkLogit(rawOver(proj, point), CALIBRATION_SHRINK);
}

/**
 * A Yes/No milestone (double- or triple-double): each component stat's chance
 * of reaching 10 from its own projection, combined into the chance that at
 * least `needed` of them do. The components are treated as independent, which
 * slightly understates a player whose big nights come all at once (minutes
 * drive them together) — the props backtest's calibration catches that.
 * Returned as a projection whose distribution prices "Over 0.5" at that chance.
 */
export function projectMilestone(
  logs: GameLogPoint[],
  components: NbaPropStatDef[],
  needed: number,
  ctx: ProjectionContext
): PropProjection | null {
  const projections = components.map((c) => projectProp(logs, c, ctx));
  if (projections.some((p) => p === null)) return null;
  const p10 = projections.map((p) => rawOver(p!, 9.5));
  // P(exactly k of them reach 10), built up one component at a time.
  let dist = [1];
  for (const p of p10) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] += q * (1 - p);
      next[k + 1] += q * p;
    });
    dist = next;
  }
  const prob = Math.min(Math.max(dist.slice(needed).reduce((a, b) => a + b, 0), 1e-6), 1 - 1e-6);
  const base = projections[0]!;
  return { ...base, mean: prob, sd: 0, distribution: { kind: "atLeastOne", mean: -Math.log(1 - prob) } };
}
