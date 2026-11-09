/**
 * ARCHR's NFL prop projection, client-safe and pure — the NBA projection
 * (src/lib/nba/projection.ts) shaped for football's short seasons:
 *
 *   mean = recency-weighted per-game production (half-life 4 games),
 *          shrunk toward the player's two-season per-game rate (4 games' weight)
 *          × matchup (what the opponent allows to his position vs the league,
 *            half-regressed, capped ±15%)
 *          × game environment (nfl/environment.ts: the team's implied points
 *            vs its normal, and the spread's pass/run script)
 *
 * Probabilities by the stat's shape:
 *   - yards: normal around the mean with the player's own game-to-game spread
 *     (floored, since a few games understate it)
 *   - counts: negative binomial (over-dispersed, never tighter than Poisson)
 *   - anytime TD: Poisson chance of at least one
 * then pulled toward 50% by CALIBRATION_SHRINK until `npm run backtest:nfl-props`
 * refits it; the props pipeline (propModel/price.ts) then blends that with the
 * market.
 */
import type { NflPropStatDef } from "./propStats";
import { rawProbOver, shrinkLogit, type StatDistribution } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { seasonMix, type SeasonMix } from "@/lib/propModel/seasonMix";
import { nflEnvironment, type NflEnvironment } from "./environment";
import type { NflGameWeather } from "./weather";
import { nflStatMatchup, type NflDefenseTable, type NflPosition } from "./matchup";
import type { NflLogPoint } from "./propsMath";
import { additiveWithoutBlend, gamesWithout, gamesWithoutEach, withoutWeight, type Absence } from "@/lib/injuries/absence";
import { OPPONENT_SPILLOVER_SHARE, OWN_SCORE_SHARE } from "@/lib/gameModel/adjust";

const HALF_LIFE = 4;
const WINDOW = 17;
const PRIOR_GAMES = 4;
export const MIN_NFL_GAMES = 3;
const MATCHUP_REGRESSION = 0.5;
const MATCHUP_CAP = 0.15;
/** A yards stat's spread is at least this share of its mean (and at least YARDS_SD_FLOOR yards). */
const YARDS_SD_MIN_SHARE = 0.35;
const YARDS_SD_FLOOR = 8;
export const NFL_CALIBRATION_SHRINK = 0.8;

/**
 * Touchdowns are mostly opportunity: what a target or carry inside the 20, at
 * the goal line or into the end zone turns into, league-wide (least squares on
 * 2025–26 player-games, additive — a goal-line carry is also a red-zone carry).
 * The anytime-TD projection counts each past game as this expected-TD figure
 * blended with the TDs he actually scored (NFL_XTD_WEIGHT), which reads a
 * player's red-zone role far better than his few, lumpy scores.
 */
export const XTD_RATES = { ezTarget: 0.2574, rzTarget: 0.136, target: 0.0114, glCarry: 0.2501, rzCarry: 0.07, carry: 0.0086 } as const;
export const NFL_XTD_WEIGHT = 0.9;

/** Expected TDs from a game's opportunities; null when the game predates the play-by-play import. */
export function expectedTds(l: NflLogPoint): number | null {
  if (l.rzTargets == null || l.rzCarries == null) return null;
  const r = XTD_RATES;
  return r.ezTarget * (l.ezTargets ?? 0) + r.rzTarget * l.rzTargets + r.target * l.targets + r.glCarry * (l.glCarries ?? 0) + r.rzCarry * l.rzCarries + r.carry * l.rushAttempts;
}

export interface NflProjection {
  mean: number;
  sd: number;
  matchupFactor: number;
  games: number;
  /** When key teammates are out: the games without them that were blended in. `additive` = no joint precedent, so each absentee's own split was added one at a time (games then counts split games). */
  absence: { names: string[]; games: number; perGame: number; additive?: boolean } | null;
  /**
   * Both sides' missing-player impact (gameModel points) the environment was
   * re-read through — the opponent's share is what props used to miss
   * entirely: an opposing QB out changes our side's script and volume.
   */
  absenceImpact: { own: number; opponent: number } | null;
  /** Implied points and script from this week's lines (neutral without them). */
  env: NflEnvironment;
  /** How much of the projection rests on this season vs last. */
  seasons: SeasonMix;
  distribution: StatDistribution;
}

/** The full-history estimate counts as this many games against the without-teammate games. */
const ABSENCE_PRIOR_GAMES = 3;

export interface NflProjectionContext {
  defense: NflDefenseTable;
  opponent: string | null;
  position: NflPosition | null;
  /** Key teammates out this week (see injuries/absence). */
  absences?: Absence[];
  /** His own team's missing-player impact, in gameModel points (QB 3, skill ≤ 2). Re-reads MARKET lines only — model totals arrive pre-adjusted. */
  ownAbsenceImpact?: number;
  /** The opponent's missing-player impact, same scale. */
  opponentAbsenceImpact?: number;
  /** The spread and total the environment reads: the game model's own where the slate has them, else the books' consensus. */
  lines?: GameLines;
  isHome?: boolean | null;
  /** What his team usually scores — the environment his logs were played in. */
  baselinePoints?: number | null;
  /** The game's forecast weather (Decision 11); null/absent = neutral. */
  weather?: NflGameWeather | null;
  season?: number;
  /** Overrides NFL_XTD_WEIGHT (the backtest varies it). */
  xtdWeight?: number;
}

/**
 * Tonight's lines re-read through the absence report — for MARKET lines.
 * (Model totals never pass through here: the game model already applied
 * the same split inside adjustExpected.) The books' spread and
 * total express the market's view; the model's own absence read — gameModel
 * impacts, split between the sides exactly as adjustExpected splits an
 * expected score (60% off the missing player's own scoring, 40% added to the
 * opponent's) — shifts them before the environment is read, so the script
 * reflects who's actually missing: an opposing QB out means our side leads
 * more and runs more, a channel the raw spread understates once the total
 * has already sagged. Lines without a posted total or spread pass through.
 */
export function absenceAdjustedLines(lines: GameLines, isHome: boolean | null, ownImpact: number, opponentImpact: number): GameLines {
  if (isHome === null || (ownImpact <= 0 && opponentImpact <= 0)) return lines;
  if (lines.total === null || lines.homeSpread === null) return lines;
  const ownShift = -OWN_SCORE_SHARE * ownImpact + OPPONENT_SPILLOVER_SHARE * opponentImpact;
  const oppShift = -OWN_SCORE_SHARE * opponentImpact + OPPONENT_SPILLOVER_SHARE * ownImpact;
  const total = lines.total + ownShift + oppShift;
  // The home margin moves by (home score shift − away score shift); the spread moves opposite the margin.
  const homeMarginShift = isHome ? ownShift - oppShift : oppShift - ownShift;
  return { total, homeSpread: lines.homeSpread - homeMarginShift };
}

export function projectNflProp(allLogs: NflLogPoint[], stat: NflPropStatDef, ctx: NflProjectionContext): NflProjection | null {
  // Only games whose box score carried this stat (a missing read is not a zero).
  const logs = stat.available ? allLogs.filter(stat.available) : allLogs;
  if (logs.length < MIN_NFL_GAMES) return null;
  const xw = ctx.xtdWeight ?? NFL_XTD_WEIGHT;
  const values = logs.map((l) => {
    const v = stat.value(l);
    if (stat.key !== "anytimeTd" || xw === 0) return v;
    const x = expectedTds(l);
    return x === null ? v : (1 - xw) * v + xw * x;
  });
  const decay = values.slice(0, WINDOW).map((_, i) => Math.pow(0.5, i / HALF_LIFE));
  const decaySum = decay.reduce((a, b) => a + b, 0);
  const recent = decay.reduce((a, wi, i) => a + values[i] * wi, 0) / decaySum;
  const long = values.reduce((a, b) => a + b, 0) / values.length;
  const n = Math.min(values.length, WINDOW);
  const recentShare = n / (n + PRIOR_GAMES);
  let base = recent * recentShare + long * (1 - recentShare);
  const seasons = seasonMix(
    logs,
    values.map((_, i) => (i < decay.length ? (recentShare * decay[i]) / decaySum : 0) + (1 - recentShare) / values.length),
    ctx.season ?? logs[0].season,
    stat.value
  );

  // Key teammates out: lean on the games he's already played without them.
  let absence: NflProjection["absence"] = null;
  const without = ctx.absences?.length ? gamesWithout(logs, ctx.absences) : [];
  if (without.length >= 2) {
    const perGame = without.reduce((a, l) => a + stat.value(l), 0) / without.length;
    const w = withoutWeight(without.length, ABSENCE_PRIOR_GAMES);
    base = base * (1 - w) + perGame * w;
    absence = { names: ctx.absences!.map((a) => a.name), games: without.length, perGame };
  } else if (ctx.absences?.length) {
    // No precedent for all of them out together: add each absentee's own
    // without-split one at a time rather than adjusting by nothing.
    const each = gamesWithoutEach(logs, ctx.absences);
    const splits = each.map((games) => ({
      value: games.length ? games.reduce((a, l) => a + stat.value(l), 0) / games.length : base,
      games: games.length,
    }));
    const blended = additiveWithoutBlend(base, splits, ABSENCE_PRIOR_GAMES, 2);
    if (blended.terms > 0) {
      base = blended.value;
      absence = {
        names: ctx.absences.filter((_, i) => each[i].length >= 2).map((a) => a.name),
        games: splits.filter((s) => s.games >= 2).reduce((a, s) => a + s.games, 0),
        perGame: base,
        additive: true,
      };
    }
  }

  let matchupFactor = 1;
  if (ctx.opponent) {
    const m = nflStatMatchup(ctx.defense, ctx.opponent, stat, ctx.position);
    if (m && m.leagueAvg > 0) {
      const f = 1 + (m.perGame / m.leagueAvg - 1) * (1 - MATCHUP_REGRESSION);
      matchupFactor = Math.min(1 + MATCHUP_CAP, Math.max(1 - MATCHUP_CAP, f));
    }
  }
  const ownImpact = ctx.ownAbsenceImpact ?? 0;
  const opponentImpact = ctx.opponentAbsenceImpact ?? 0;
  const envLines = absenceAdjustedLines(ctx.lines ?? NO_LINES, ctx.isHome ?? null, ownImpact, opponentImpact);
  const env = nflEnvironment(envLines, ctx.isHome ?? null, stat.key, ctx.baselinePoints ?? null, ctx.weather);
  const mean = base * matchupFactor * env.volumeFactor * env.scriptFactor * env.weatherFactor;

  const sample = values.slice(0, WINDOW);
  const sMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sVar = sample.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(sample.length - 1, 1);
  let sd: number;
  if (stat.shape === "yards") {
    sd = Math.max(Math.sqrt(sVar), mean * YARDS_SD_MIN_SHARE, YARDS_SD_FLOOR);
  } else {
    const dispersion = sMean > 0 ? Math.max(sVar / sMean, 1) : 1;
    sd = Math.sqrt(Math.max(mean, mean * dispersion));
  }
  const distribution: StatDistribution =
    stat.shape === "anytime"
      ? { kind: "atLeastOne", mean }
      : stat.shape === "yards"
        ? { kind: "normal", mean, sd }
        : { kind: "count", mean, variance: sd * sd };
  return { mean, sd, matchupFactor, games: logs.length, absence, absenceImpact: ownImpact > 0 || opponentImpact > 0 ? { own: ownImpact, opponent: opponentImpact } : null, env, seasons, distribution };
}

/** The model's uncalibrated chance the Over cashes at `point` (pushes refund). */
export function nflRawOver(proj: NflProjection, point: number): number {
  return rawProbOver(proj.distribution, point);
}

/** The model's chance the Over cashes at `point`, calibrated by NFL_CALIBRATION_SHRINK. */
export function nflProbOver(proj: NflProjection, _stat: NflPropStatDef, point: number): number {
  return shrinkLogit(nflRawOver(proj, point), NFL_CALIBRATION_SHRINK);
}
