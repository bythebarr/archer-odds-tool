/**
 * Opposing-starter strikeout context for BATTER-K props.
 *
 * The mirror of opponentKRate.ts, on the other side of the plate. A matchup
 * study (scripts/matchup-batter.ts) showed a batter beats his own strikeout-prop
 * projection by ~+10pt more against a high-K starter than a soft-tossing one — a
 * strong, lookahead-safe signal the batter's own rate can't see. (The same study
 * found the opposing starter's HITS-allowed rate does NOT predict batter hit
 * props out of sample — DIPS theory: pitchers barely control balls in play — so
 * only the strikeout matchup is modeled here.)
 *
 * Pure and DB-free: the caller passes the pitchers' start rows and we build each
 * starter's trailing K-per-batter-faced series; the caller supplies the opposing
 * starter id + date. Trailing-only, so lookups are lookahead-safe when asked for
 * a rate strictly BEFORE the game being predicted.
 */

/** A starter's line for one start (strikeouts over batters faced). */
export interface StarterKGame {
  date: Date;
  strikeouts: number;
  battersFaced: number;
}

export interface StarterKModel {
  /** pitcherId → date-sorted per-start (K, BF) totals. */
  series: Map<string, StarterKGame[]>;
  /** Population K-per-batter-faced across every start — the neutral prior. */
  leagueRate: number;
}

/**
 * Batter-K opponent term, fit by OLS of the batter-only residual on the opposing
 * starter's league-relative K/BF over all games (matchup-batter.ts). Improves
 * out-of-sample Brier on Batter Ks o0.5 (0.2347 → 0.2314).
 */
export const BATTER_K_VS_STARTER_BETA = 0.8643;

/** Minimum batters faced before a starter's trailing K rate is trusted. */
export const MIN_STARTER_BF = 200;

interface StarterRow {
  mlbPlayerId: string;
  gameDate: Date;
  strikeoutsPitching: number | null;
  outsRecorded: number | null;
  hitsAllowed: number | null;
  walksAllowed: number | null;
}

/** Build the per-starter trailing K/BF model from pitcher start rows. */
export function buildStarterKModel(rows: StarterRow[]): StarterKModel {
  const series = new Map<string, StarterKGame[]>();
  let lgK = 0;
  let lgBF = 0;
  for (const r of rows) {
    // Batters faced ≈ outs recorded + hits allowed + walks allowed (omits HBP /
    // reached-on-error — a negligible slice, and consistent across the sample).
    const bf = (r.outsRecorded ?? 0) + (r.hitsAllowed ?? 0) + (r.walksAllowed ?? 0);
    if (bf <= 0) continue;
    const k = r.strikeoutsPitching ?? 0;
    lgK += k;
    lgBF += bf;
    const arr = series.get(r.mlbPlayerId) ?? [];
    arr.push({ date: r.gameDate, strikeouts: k, battersFaced: bf });
    series.set(r.mlbPlayerId, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { series, leagueRate: lgBF > 0 ? lgK / lgBF : 0.218 };
}

/**
 * A starter's trailing K-per-batter-faced from starts strictly before `before`.
 * Returns null when the starter is unknown or below MIN_STARTER_BF (too thin).
 */
export function opposingStarterKRate(model: StarterKModel, starterId: string | null | undefined, before: Date): number | null {
  if (!starterId) return null;
  const arr = model.series.get(starterId);
  if (!arr) return null;
  let k = 0;
  let bf = 0;
  for (const g of arr) {
    if (g.date >= before) break; // date-sorted
    k += g.strikeouts;
    bf += g.battersFaced;
  }
  return bf >= MIN_STARTER_BF ? k / bf : null;
}

/**
 * The additive probability shift for a batter-K prop given the opposing
 * starter's trailing K rate. `beta · (starterRate − leagueRate)`; 0 when the
 * rate is unavailable (thin/unknown) — a safe no-op.
 */
export function batterKvsStarterShift(starterKRate: number | null, leagueRate: number): number {
  if (starterKRate === null) return 0;
  return BATTER_K_VS_STARTER_BETA * (starterKRate - leagueRate);
}
