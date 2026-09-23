/**
 * v1.4 prop markets (batch B). Pure.
 *
 * **Longest reception / rush / completion.** A player's longest play clears L
 * if any of his N touches does. With N ~ Poisson(μ) (μ = the frozen model's
 * projected receptions / carries / completions) and each touch clearing L
 * with probability S(L), independently:
 *
 *     P(longest > L) = 1 − exp(−μ · S(L))
 *
 * S is his position's empirical single-play survival curve (train seasons),
 * stretched by his own shrunk yards-per-touch relative to the position:
 * S_player(L) = S_pos(L × ypp_pos / ypp_player). So an explosive receiver's
 * curve has a longer tail, and a high-volume one gets more draws.
 *
 * **Kickers.** FG made ~ Poisson(λ), with λ linear in the market-implied team
 * points, the TD model's projected team TDs (drives that end in TDs don't end
 * in FGs), and the kicker's own decayed FG rate. Kicking points = 3·FG +
 * extra points, whose mean is 3λ + (XP per TD)·team TDs, with its own
 * empirical distribution.
 *
 * **First TD scorer.** P(first) = (λ_player / λ_game) · (1 − e^(−λ_game)),
 * where λ_game = both teams' projected TDs + δ for non-offensive TDs
 * (returns, defense), which beat every offensive player to it.
 */

export const BATCH_B_MARKETS = ["longestReception", "longestRush", "longestCompletion", "fgMade", "kickingPoints", "firstTd"] as const;
export type BatchBMarket = (typeof BATCH_B_MARKETS)[number];

export function isBatchBMarket(m: string): m is BatchBMarket {
  return (BATCH_B_MARKETS as readonly string[]).includes(m);
}

/** Single-play gains reduced to evenly spaced sorted quantiles, plus their mean. */
export interface SurvivalCurve {
  q: number[];
  mean: number;
}

export function buildSurvival(gains: readonly number[], quantiles = 201): SurvivalCurve {
  const s = Float64Array.from(gains).sort();
  const q = Array.from({ length: quantiles }, (_, i) => {
    const pos = (i / (quantiles - 1)) * (s.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(s.length - 1, lo + 1);
    return +(s[lo] + (s[hi] - s[lo]) * (pos - lo)).toFixed(3);
  });
  return { q, mean: gains.reduce((a, b) => a + b, 0) / gains.length };
}

/** P(single play > x), interpolated between quantiles. */
export function survivalAt(c: SurvivalCurve, x: number): number {
  const q = c.q;
  const n = q.length;
  if (x < q[0]) return 1;
  if (x >= q[n - 1]) return 0.5 / n; // beyond the observed max: small, not zero
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (q[mid] <= x) lo = mid;
    else hi = mid;
  }
  const frac = q[hi] === q[lo] ? 1 : (x - q[lo]) / (q[hi] - q[lo]);
  const cdf = (lo + frac) / (n - 1);
  return Math.max(0.5 / n, 1 - cdf);
}

/** P(longest play > line) given μ expected touches and the player's yards-per-touch. */
export function pLongestOver(mu: number, curve: SurvivalCurve, playerYpp: number, line: number): number {
  const scale = playerYpp > 0 ? curve.mean / playerYpp : 1;
  return 1 - Math.exp(-mu * survivalAt(curve, line * scale));
}

/** E[longest] ≈ Σ_{x≥0} P(longest > x), in whole yards — a display number only. */
export function expectedLongest(mu: number, curve: SurvivalCurve, playerYpp: number): number {
  let e = 0;
  for (let x = 0; x < 110; x++) e += pLongestOver(mu, curve, playerYpp, x);
  return e;
}

export interface KickParams {
  /** FG made λ = a + b·implied team points + c·projected team TDs + d·kicker's recent FG made/game. */
  fg: [number, number, number, number];
  /** Extra points made per projected team TD. */
  xpPerTd: number;
  /** Kicker recent-form decay half-life (games) and prior strength (pseudo-games at league rate). */
  halfLife: number;
  priorGames: number;
}

export function fgLambda(p: KickParams, implied: number, teamTds: number, recentFgm: number): number {
  return Math.max(0.2, p.fg[0] + p.fg[1] * implied + p.fg[2] * teamTds + p.fg[3] * recentFgm);
}

export function kickingPointsMean(p: KickParams, fgLam: number, teamTds: number): number {
  return 3 * fgLam + p.xpPerTd * teamTds;
}

/** Decayed per-kicker FG-made rate, shrunk toward the league rate. Walk-forward: read before folding the week. */
export class KickerTracker {
  private readonly acc = new Map<string, { fgm: number; games: number }>();
  private leagueFgm = 0;
  private leagueGames = 0;

  constructor(private readonly halfLife: number, private readonly priorGames: number) {}

  recentFgm(playerId: string): number {
    const a = this.acc.get(playerId) ?? { fgm: 0, games: 0 };
    const league = this.leagueGames ? this.leagueFgm / this.leagueGames : 1.6;
    return (a.fgm + this.priorGames * league) / (a.games + this.priorGames);
  }

  priorGamesOf(playerId: string): number {
    return this.acc.get(playerId)?.games ?? 0;
  }

  fold(games: readonly { playerId: string; fgMade: number }[]): void {
    const d = Math.pow(0.5, 1 / this.halfLife);
    for (const g of games) {
      const a = this.acc.get(g.playerId) ?? { fgm: 0, games: 0 };
      this.acc.set(g.playerId, { fgm: a.fgm * d + g.fgMade, games: a.games * d + 1 });
      this.leagueFgm += g.fgMade;
      this.leagueGames += 1;
    }
  }
}

export function firstTdProbability(playerLambda: number, gameLambda: number): number {
  if (gameLambda <= 0) return 0;
  return (playerLambda / gameLambda) * (1 - Math.exp(-gameLambda));
}
