/**
 * Soccer goals model — an online Poisson attack/defense model (the recognized
 * soccer approach, Dixon-Coles lineage) instead of a 2-way Elo, because soccer is
 * THREE-way: home / DRAW / away. Each team carries a log-scale attack and defense
 * strength; expected goals for each side come from those plus a home advantage, and
 * a Poisson score matrix turns the two expected-goal rates into P(home)/P(draw)/
 * P(away) — draws fall out natively.
 *
 * Ratings update online by stochastic gradient on the Poisson log-likelihood (the
 * gradient of a Poisson mean λ against an observed count g is simply g − λ), so it's
 * walk-forward and lookahead-safe like our Elos — no global optimizer, no leakage —
 * and reverts toward the mean between seasons for roster churn. This same model opens
 * goals-based markets later (totals, BTTS, correct score) for free.
 */

export interface SoccerPoissonOpts {
  lr: number; // SGD learning rate on attack/defense
  homeAdv: number; // home advantage, log-goals
  baseGoals: number; // log of league baseline goals per team per game
  seasonRevert: number; // fraction of strength reverted toward 0 each new season
  maxGoals: number; // score-matrix truncation
  /**
   * Draw inflation (Dixon-Coles-style low-score correction, simplified). Independent
   * Poisson under-produces draws and over-produces favorites, leaving the raw model
   * overconfident (its 80% picks won ~75%). This multiplies the diagonal (draw)
   * score-matrix cells by (1 + drawBoost) before normalizing, pulling probability mass
   * from the over-confident favorites onto draws — the principled fix, not a blunt
   * temperature that would flatten everything toward a 1/3 uniform.
   */
  drawBoost: number;
}

export const DEFAULT_SOCCER_POISSON: SoccerPoissonOpts = {
  lr: 0.06,
  homeAdv: 0.26, // ~exp(.26) ≈ 1.3× home scoring bump
  baseGoals: Math.log(1.35), // ≈ 1.35 goals/team/game
  seasonRevert: 1 / 3,
  maxGoals: 10,
  drawBoost: 0.5, // tuned on the reliability curve (see docs/architecture/calibration.md)
};

const factorial: number[] = (() => {
  const f = [1];
  for (let k = 1; k <= 20; k++) f[k] = f[k - 1] * k;
  return f;
})();

const poissonPmf = (k: number, lambda: number): number =>
  (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial[k];

export interface OutcomeProbs {
  home: number;
  draw: number;
  away: number;
}

export class SoccerPoisson {
  private att = new Map<string, number>();
  private def = new Map<string, number>();
  private g = new Map<string, number>();
  private lastSeason = new Map<string, number>();

  constructor(private readonly opts: SoccerPoissonOpts = DEFAULT_SOCCER_POISSON) {}

  private a(t: string): number {
    return this.att.get(t) ?? 0;
  }
  private d(t: string): number {
    return this.def.get(t) ?? 0;
  }
  gamesPlayed(t: string): number {
    return this.g.get(t) ?? 0;
  }

  /** Apply between-season reversion the first time a team appears in a new season. */
  touch(team: string, season: number): void {
    const last = this.lastSeason.get(team);
    if (last !== undefined && season > last) {
      const keep = 1 - this.opts.seasonRevert;
      this.att.set(team, this.a(team) * keep);
      this.def.set(team, this.d(team) * keep);
    }
    this.lastSeason.set(team, season);
  }

  /** Expected goals for each side (home advantage baked into the home rate). */
  expectedGoals(home: string, away: string): { lh: number; la: number } {
    const lh = Math.exp(this.opts.baseGoals + this.opts.homeAdv + this.a(home) - this.d(away));
    const la = Math.exp(this.opts.baseGoals + this.a(away) - this.d(home));
    // Clamp to keep the score matrix well-behaved on cold-start extremes.
    return { lh: Math.min(6, Math.max(0.15, lh)), la: Math.min(6, Math.max(0.15, la)) };
  }

  /** P(home win) / P(draw) / P(away win) from the Poisson score matrix. */
  outcomeProbs(home: string, away: string): OutcomeProbs {
    const { lh, la } = this.expectedGoals(home, away);
    let h = 0;
    let dr = 0;
    let a = 0;
    for (let i = 0; i <= this.opts.maxGoals; i++) {
      const pi = poissonPmf(i, lh);
      for (let j = 0; j <= this.opts.maxGoals; j++) {
        const p = pi * poissonPmf(j, la);
        if (i > j) h += p;
        else if (i === j) dr += p * (1 + this.opts.drawBoost); // low-score/draw correction
        else a += p;
      }
    }
    const tot = h + dr + a || 1;
    return { home: h / tot, draw: dr / tot, away: a / tot };
  }

  /** Update both teams' attack/defense from an observed scoreline. */
  update(home: string, away: string, homeGoals: number, awayGoals: number): void {
    const { lh, la } = this.expectedGoals(home, away);
    const eh = homeGoals - lh; // home attack / away defense error
    const ea = awayGoals - la; // away attack / home defense error
    const lr = this.opts.lr;
    this.att.set(home, this.a(home) + lr * eh);
    this.def.set(away, this.d(away) - lr * eh);
    this.att.set(away, this.a(away) + lr * ea);
    this.def.set(home, this.d(home) - lr * ea);
    this.g.set(home, this.gamesPlayed(home) + 1);
    this.g.set(away, this.gamesPlayed(away) + 1);
  }
}
