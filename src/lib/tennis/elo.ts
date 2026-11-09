/**
 * Surface-aware tennis Elo — the ARCHR tennis model's core, the analog of the MLB
 * Archer win-prob and UFC fighter-math. Pure and deterministic: replay a
 * chronological match list through `update`, then `winProb` gives P(a beats b).
 *
 * Structure follows the well-validated FiveThirtyEight tennis-Elo design:
 *   - Each player carries an OVERALL rating plus a per-SURFACE rating (hard / clay /
 *     grass / carpet). A prediction blends the two, so clay specialists are rated
 *     up on clay and down on grass rather than by one flat number.
 *   - The K-factor DECAYS with matches played (`k / (n + offset)^exp`): a new
 *     player's rating moves fast, a veteran's is stable. Overall and surface each
 *     decay on their own match count.
 *   - Ratings also decay with TIME (Decision 13): read as of a date, a rating
 *     is pulled toward the base by the player's layoff since their last match,
 *     so a two-year absence no longer returns at full weight.
 *
 * No I/O — the adapter's backtest replays `TennisArchiveMatch` through this, and
 * live pricing (T4) reads current ratings out of a replay. Unit-tested in elo.test.ts.
 */

export type Surface = "hard" | "clay" | "grass" | "carpet";

/** Normalize Sackmann's surface strings (which include case dupes like "Clay"/"clay"). */
export function canonicalSurface(s: string | null | undefined): Surface | null {
  if (!s) return null;
  const l = s.toLowerCase();
  return l === "hard" || l === "clay" || l === "grass" || l === "carpet" ? l : null;
}

export interface EloParams {
  /** Starting rating for an unseen player. */
  base: number;
  /** K numerator (538 uses 250). */
  k: number;
  /** K denominator offset — softens the early-career swing. */
  kOffset: number;
  /** K decay exponent. */
  kExp: number;
  /** Blend weight on the surface rating vs. overall (0 = ignore surface, 1 = surface only). */
  surfaceWeight: number;
  /**
   * Empirical overconfidence calibration — a logit shrink toward 0.5 on the final
   * win probability, the same technique baked into the MLB (0.2) and UFC (0.5)
   * models. A lookahead-safe backtest over ~20k archive matches showed raw Elo was
   * systematically overconfident by ~4pt (its 68% picks won 64%); a shrink of 0.75,
   * fit on the older 60% and validated on the newer 40% (test Brier 0.2202 → 0.2184),
   * lines the buckets up while keeping the model's real discrimination. Only the
   * probability is shrunk, never the ratings themselves (those stay interpretable).
   */
  calibrationShrink: number;
  /**
   * Layoff decay half-life, in days (Decision 13). A rating earned two
   * years ago is not evidence about today's player — injuries, age and
   * rust move tennis players fast — so at read time a rating is pulled
   * toward `base` by half for every half-life the player has been idle:
   * rating' = base + (rating − base) × 0.5^(idleDays / halfLife). One
   * year: a 1700 plays like a 1600 after a year out, a 1550 after two.
   * Applied when a probability is READ (winProbAsOf / decayStoredRating),
   * never written back — the stored rating stays the earned one, and the
   * next played match resumes updating from it. Non-finite or ≤ 0 = off.
   */
  layoffHalfLifeDays: number;
}

export const DEFAULT_ELO: EloParams = {
  base: 1500,
  k: 250,
  kOffset: 5,
  kExp: 0.4,
  surfaceWeight: 0.5,
  calibrationShrink: 0.75,
  layoffHalfLifeDays: 365,
};

/** Pull a rating toward the base by the layoff decay for `idleDays` idle. Pure. */
export function decayRatingTowardBase(rating: number, base: number, idleDays: number, halfLifeDays: number): number {
  if (!(idleDays > 0) || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return rating;
  return base + (rating - base) * 0.5 ** (idleDays / halfLifeDays);
}

interface Rating {
  overall: number;
  nOverall: number;
  surface: Partial<Record<Surface, number>>;
  nSurface: Partial<Record<Surface, number>>;
}

/** Logistic Elo expectation: P(a beats b) from a rating gap, on the standard 400 scale. */
export function eloExpectation(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/** Blend a player's overall + surface rating (surface null/absent → overall only). */
export function blend(
  overall: number,
  surfaceRating: number | null | undefined,
  surfaceWeight: number
): number {
  if (surfaceRating === null || surfaceRating === undefined) return overall;
  return surfaceWeight * surfaceRating + (1 - surfaceWeight) * overall;
}

/** Logit shrink toward 0.5 — the baked overconfidence calibration (identity at 1.0). */
export function shrinkProbability(p: number, shrink: number): number {
  if (shrink === 1) return p;
  return 1 / (1 + Math.exp(-shrink * Math.log(p / (1 - p))));
}

/** A player's current ratings as stored in TennisRating — the live-pricing input. */
export interface StoredRating {
  overall: number;
  hard?: number | null;
  clay?: number | null;
  grass?: number | null;
  carpet?: number | null;
}

/**
 * P(a beats b) on `surface` from STORED ratings — the live-pricing path, sharing the
 * exact blend + calibration shrink the backtest used, so a priced play's probability
 * equals what the backtest scored. Used by the tennis adapter's listPlays.
 */
export function winProbFromRatings(
  a: StoredRating,
  b: StoredRating,
  surface: Surface | null,
  params: EloParams = DEFAULT_ELO
): number {
  const ra = blend(a.overall, surface ? a[surface] : null, params.surfaceWeight);
  const rb = blend(b.overall, surface ? b[surface] : null, params.surfaceWeight);
  return shrinkProbability(eloExpectation(ra, rb), params.calibrationShrink);
}

/**
 * A stored rating with the layoff decay applied as of a date (Decision 13):
 * overall and every surface rating pulled toward the base by how long the
 * player has been idle. Null lastPlayed (never recorded) = no decay — the
 * pre-decay behavior for rows the ratings rebuild hasn't stamped yet.
 */
export function decayStoredRating(
  r: StoredRating,
  lastPlayedAt: Date | null | undefined,
  asOf: Date,
  params: EloParams = DEFAULT_ELO
): StoredRating {
  if (!lastPlayedAt) return r;
  const idleDays = Math.max(0, (asOf.getTime() - lastPlayedAt.getTime()) / 86_400_000);
  const d = (x: number | null | undefined) => (x === null || x === undefined ? x : decayRatingTowardBase(x, params.base, idleDays, params.layoffHalfLifeDays));
  return { overall: decayRatingTowardBase(r.overall, params.base, idleDays, params.layoffHalfLifeDays), hard: d(r.hard), clay: d(r.clay), grass: d(r.grass), carpet: d(r.carpet) };
}

export class TennisElo {
  private readonly p: EloParams;
  private readonly ratings = new Map<string, Rating>();
  /** Each player's most recent match date, when update() was given one — the layoff decay's clock. */
  private readonly lastPlayed = new Map<string, Date>();

  constructor(params: Partial<EloParams> = {}) {
    this.p = { ...DEFAULT_ELO, ...params };
  }

  private kFor(n: number): number {
    return this.p.k / (n + this.p.kOffset) ** this.p.kExp;
  }

  private ratingOf(id: string): Rating {
    let r = this.ratings.get(id);
    if (!r) {
      r = { overall: this.p.base, nOverall: 0, surface: {}, nSurface: {} };
      this.ratings.set(id, r);
    }
    return r;
  }

  /** Whether this player has been seen at all (for confidence gating in pricing). */
  has(id: string): boolean {
    return this.ratings.has(id);
  }

  /** Total career matches seen for a player (0 if unseen). */
  matchesPlayed(id: string): number {
    return this.ratings.get(id)?.nOverall ?? 0;
  }

  /** The surface-blended rating used for prediction. Falls back to overall off-surface. */
  blendedRating(id: string, surface: Surface | null): number {
    const r = this.ratingOf(id);
    return blend(r.overall, surface ? r.surface[surface] ?? null : null, this.p.surfaceWeight);
  }

  /**
   * P(player a beats player b) on the given surface, using current blended ratings,
   * with the calibration shrink applied — this is the model's honest, backtested
   * probability (the number pricing and EV use).
   */
  winProb(aId: string, bId: string, surface: Surface | null): number {
    const raw = eloExpectation(this.blendedRating(aId, surface), this.blendedRating(bId, surface));
    return shrinkProbability(raw, this.p.calibrationShrink);
  }

  /** A player's blended rating with the layoff decay applied as of `asOf` (Decision 13). */
  private decayedBlendedRating(id: string, surface: Surface | null, asOf: Date): number {
    const r = this.ratingOf(id);
    const last = this.lastPlayed.get(id);
    const idleDays = last ? Math.max(0, (asOf.getTime() - last.getTime()) / 86_400_000) : 0;
    const overall = decayRatingTowardBase(r.overall, this.p.base, idleDays, this.p.layoffHalfLifeDays);
    const surf = surface ? r.surface[surface] : undefined;
    const surfDecayed = surf === undefined ? null : decayRatingTowardBase(surf, this.p.base, idleDays, this.p.layoffHalfLifeDays);
    return blend(overall, surfDecayed, this.p.surfaceWeight);
  }

  /**
   * winProb as of a date: both players' ratings decayed by their idle time
   * before the probability is taken. This is the graded form (the backtest
   * sampler scores it) and mirrors what live pricing does to stored
   * ratings via decayStoredRating.
   */
  winProbAsOf(aId: string, bId: string, surface: Surface | null, asOf: Date): number {
    const raw = eloExpectation(this.decayedBlendedRating(aId, surface, asOf), this.decayedBlendedRating(bId, surface, asOf));
    return shrinkProbability(raw, this.p.calibrationShrink);
  }

  /** When a player last played, when dates were supplied to update(). */
  lastPlayedAt(id: string): Date | null {
    return this.lastPlayed.get(id) ?? null;
  }

  /** Snapshot every player's current ratings — the input to the persisted ratings store. */
  exportRatings(): Array<{
    id: string;
    overall: number;
    nOverall: number;
    surface: Partial<Record<Surface, number>>;
    lastPlayed: Date | null;
  }> {
    return [...this.ratings.entries()].map(([id, r]) => ({
      id,
      overall: r.overall,
      nOverall: r.nOverall,
      surface: { ...r.surface },
      lastPlayed: this.lastPlayed.get(id) ?? null,
    }));
  }

  /** Apply one settled match (winner beat loser on `surface`), updating both ratings. `date` (the match's date) feeds the layoff decay clock when given. */
  update(winnerId: string, loserId: string, surface: Surface | null, date?: Date): void {
    if (date) {
      this.lastPlayed.set(winnerId, date);
      this.lastPlayed.set(loserId, date);
    }
    const w = this.ratingOf(winnerId);
    const l = this.ratingOf(loserId);

    // Seed a first-time surface rating from the player's PRE-update overall, so the
    // surface and overall tracks start from the same baseline (seeding after the
    // overall update would bias every player's surface rating low).
    if (surface) {
      if (w.surface[surface] === undefined) {
        w.surface[surface] = w.overall;
        w.nSurface[surface] = 0;
      }
      if (l.surface[surface] === undefined) {
        l.surface[surface] = l.overall;
        l.nSurface[surface] = 0;
      }
    }

    // Overall update, each player's K decaying on its own overall match count.
    const expW = eloExpectation(w.overall, l.overall);
    w.overall += this.kFor(w.nOverall) * (1 - expW);
    l.overall -= this.kFor(l.nOverall) * (1 - expW);
    w.nOverall++;
    l.nOverall++;

    // Surface update, on the surface ratings' own gap + match counts.
    if (surface) {
      const expWs = eloExpectation(w.surface[surface]!, l.surface[surface]!);
      w.surface[surface]! += this.kFor(w.nSurface[surface]!) * (1 - expWs);
      l.surface[surface]! -= this.kFor(l.nSurface[surface]!) * (1 - expWs);
      w.nSurface[surface]!++;
      l.nSurface[surface]!++;
    }
  }
}
