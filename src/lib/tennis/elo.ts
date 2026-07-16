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
}

export const DEFAULT_ELO: EloParams = {
  base: 1500,
  k: 250,
  kOffset: 5,
  kExp: 0.4,
  surfaceWeight: 0.5,
  calibrationShrink: 0.75,
};

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

export class TennisElo {
  private readonly p: EloParams;
  private readonly ratings = new Map<string, Rating>();

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
    if (!surface) return r.overall;
    const sr = r.surface[surface] ?? r.overall;
    return this.p.surfaceWeight * sr + (1 - this.p.surfaceWeight) * r.overall;
  }

  /** Apply the baked overconfidence shrink toward 0.5 in logit space (identity at 1.0). */
  private shrink(p: number): number {
    const s = this.p.calibrationShrink;
    if (s === 1) return p;
    return 1 / (1 + Math.exp(-s * Math.log(p / (1 - p))));
  }

  /**
   * P(player a beats player b) on the given surface, using current blended ratings,
   * with the calibration shrink applied — this is the model's honest, backtested
   * probability (the number pricing and EV use).
   */
  winProb(aId: string, bId: string, surface: Surface | null): number {
    const raw = eloExpectation(this.blendedRating(aId, surface), this.blendedRating(bId, surface));
    return this.shrink(raw);
  }

  /** Apply one settled match (winner beat loser on `surface`), updating both ratings. */
  update(winnerId: string, loserId: string, surface: Surface | null): void {
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
