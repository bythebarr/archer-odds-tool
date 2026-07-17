/**
 * The "Archer Prop Projection": a calibrated next-game hit probability for a
 * player prop, the honest counterweight to the raw trailing hit-rate the board
 * shows. A lookahead-safe backtest over ~23,000 player-games proved the raw
 * L10 rate is the WORST predictor of the next game — a batter who cleared the
 * line in 9 of his last 10 actually hits only ~65% next time (a 27-point
 * overconfidence gap), and cold players bounce back up hard. Recent hit-rate is
 * mostly noise and mean-reversion; the player's SEASON rate is a better guide,
 * and better still is regressing that season rate toward the population base.
 *
 * The model is empirical Bayes: treat the population base rate as a prior worth
 * K games, add the player's actual season record, and read off the posterior
 * mean — small samples get pulled hard toward the field, big samples are
 * trusted more. A small recency tilt nudges toward the L10 rate, because the
 * backtest did find a faint-but-real hot/cold signal (~+2–3pt at the extremes,
 * no more). K and the tilt were fit on the older 70% of games and validated on
 * the newer 30%, beating both raw-L10 and season-rate on out-of-sample Brier
 * for every prop tested (e.g. Hits o0.5: 0.2436 vs L10 0.2550 / season 0.2447).
 *
 * This is the number that should rank the board and — once paid props-odds land
 * — generate honest prop EV, the same way the calibrated MLB/UFC models feed
 * game-line EV. It removes overconfidence, not any real edge.
 */

/**
 * Strength of the population prior, in games. The season record is shrunk as if
 * we'd already seen K games at the base rate. ~30 was the stable fit across
 * stats and lines (best K ranged 26–38); a round 30 sits in the flat middle of
 * that curve. Higher = more regression toward the field.
 */
export const PRIOR_STRENGTH_GAMES = 30;

/**
 * How much to tilt toward the recent (L10) rate, on top of the shrunk season
 * estimate. Deliberately tiny — the backtest's best fit was 0–0.1 depending on
 * the prop, because recency barely predicts. Kept nonzero so a genuinely
 * changed role/health shows through a little, not because streaks are magic.
 */
export const RECENCY_TILT = 0.05;

/** Never claim near-certainty on a single game — same honesty as the game-line models' caps. */
const PROB_FLOOR = 0.02;
const PROB_CEILING = 0.98;

export interface PropProjectionInput {
  /** Season games that cleared the line (the "successes"). */
  seasonHits: number;
  /** Season games with a recorded value for this stat (the sample). */
  seasonSample: number;
  /** Recent-window (L10) hit rate in [0,1], or null when there's no recent sample. */
  recentRate: number | null;
  /** Population base rate for this exact (stat, line) — what a typical qualifying player does. */
  baseRate: number;
}

export interface PropProjection {
  /** Calibrated P(clears the line next game), clamped to [PROB_FLOOR, PROB_CEILING]. */
  probability: number;
  /** The empirical-Bayes season estimate before the recency tilt — exposed for transparency. */
  shrunkRate: number;
  /** probability − baseRate: how much this player beats (or trails) the field. The real signal. */
  edgeVsBase: number;
}

/**
 * Per-family calibration overrides. The default K/tilt were fit on BATTING props;
 * pitching props ride a within-season workload ramp (starters stretch out from
 * short April outings to 6+ inning summer starts) that a season-pooled base rate
 * understates, so they want their own K/tilt. Omitted fields fall back to the
 * module defaults, keeping existing callers byte-for-byte identical.
 */
export interface PropProjectionOptions {
  /** Override the population-prior strength (games). Defaults to PRIOR_STRENGTH_GAMES. */
  priorGames?: number;
  /** Override the recency tilt weight. Defaults to RECENCY_TILT. */
  recencyTilt?: number;
  /**
   * Season-progress ramp correction (pitching only). A calibration study proved
   * every pitching counting stat rides a within-season workload ramp: starters
   * stretch from short April outings to 6+ inning summer starts, so the over-rate
   * climbs ~linearly with how deep into the season the pitcher is — a bias a
   * season-pooled base rate and a flat season rate structurally cannot track
   * (K/tilt tuning moved it <0.3pt). `seasonSample` — the count of prior starts —
   * IS that progress index, so the fix is a linear adjustment in it:
   *   adjustment = slope · (seasonSample − pivot)
   * `slope` is prob-per-prior-start (fit per prop on the older games, validated on
   * the newer); `pivot` is where the adjustment crosses zero (the season-average
   * progress). `cap` bounds the progress index — workload saturates (a starter
   * tops out near 6–7 innings, he can't ramp forever), so past `cap` starts the
   * correction holds flat; without it a linear term overshoots late-season games.
   * Omit for batting — it has no ramp (a regular's PA are flat all year).
   */
  ramp?: { slope: number; pivot: number; cap?: number };
}

/**
 * Project a player's next-game hit probability for one prop line. Pure and
 * DB-free so it's unit-testable; the board layer supplies the population
 * baseRate (see mlbBoard.ts). Returns null only when there's no season sample
 * to stand on — nothing to project from.
 */
export function projectPropHit(
  input: PropProjectionInput,
  options: PropProjectionOptions = {}
): PropProjection | null {
  const { seasonHits, seasonSample, recentRate, baseRate } = input;
  if (seasonSample <= 0) return null;

  const priorGames = options.priorGames ?? PRIOR_STRENGTH_GAMES;
  const recencyTilt = options.recencyTilt ?? RECENCY_TILT;

  // Empirical-Bayes posterior mean: prior of K games at the base rate, plus the
  // player's actual season record.
  const shrunkRate = (seasonHits + priorGames * baseRate) / (seasonSample + priorGames);

  // Small additive nudge toward recent form (recentRate − seasonRate), so a
  // hot/cold streak moves the number a little without letting it run the show.
  const seasonRate = seasonHits / seasonSample;
  const tilt = recentRate === null ? 0 : recencyTilt * (recentRate - seasonRate);

  // Season-progress ramp: a bounded linear correction in how deep into the
  // season the pitcher is (seasonSample = prior starts), held flat past `cap`
  // because workload saturates. Zero unless a family supplies it.
  const ramp = options.ramp
    ? options.ramp.slope * (Math.min(seasonSample, options.ramp.cap ?? Infinity) - options.ramp.pivot)
    : 0;

  const probability = Math.min(Math.max(shrunkRate + tilt + ramp, PROB_FLOOR), PROB_CEILING);
  return { probability, shrunkRate, edgeVsBase: probability - baseRate };
}

/**
 * Pooled population base rate for a single (stat, line): total games that
 * cleared the line divided by total games played, across every entity on the
 * board. Sample-weighted (regulars dominate), so it reads as "what a typical
 * player who actually plays does at this line" — the right prior for the board's
 * population. Falls back to a neutral 0.5 if the population has no sample at all.
 */
export function pooledBaseRate(pool: { seasonHits: number; seasonSample: number }[]): number {
  let hits = 0;
  let sample = 0;
  for (const p of pool) {
    hits += p.seasonHits;
    sample += p.seasonSample;
  }
  return sample > 0 ? hits / sample : 0.5;
}
