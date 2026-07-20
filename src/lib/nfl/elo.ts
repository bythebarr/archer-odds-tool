/**
 * NFL Elo — a standard, defensible team-strength model (FiveThirtyEight lineage):
 * home-field advantage as an Elo bump, a margin-of-victory–scaled update, and a
 * between-season reversion toward the mean (NFL rosters/coaches churn hard, so a
 * team's rating must decay back toward average each offseason).
 *
 * Deliberately public-info only and no lookahead: each prediction uses ratings
 * built strictly from prior games, so the CLV backtest is honest by construction.
 * Same shape as `TennisElo` (winProb / update) so it plugs into the same harness.
 */

export interface NflEloOpts {
  start: number; // baseline rating
  k: number; // update speed
  hfa: number; // home-field advantage, in Elo points
  pointsPerElo: number; // Elo points per 1 point of expected margin (~25)
  revert: number; // fraction reverted toward `start` each new season (0..1)
}

export const DEFAULT_NFL_ELO: NflEloOpts = {
  start: 1500,
  k: 20,
  hfa: 60, // ~2.4 pts; modern HFA is smaller than the old ~3
  pointsPerElo: 25,
  revert: 1 / 3,
};

export class NflElo {
  private r = new Map<string, number>();
  private g = new Map<string, number>();
  private lastSeason = new Map<string, number>();

  constructor(private readonly opts: NflEloOpts = DEFAULT_NFL_ELO) {}

  rating(team: string): number {
    return this.r.get(team) ?? this.opts.start;
  }
  gamesPlayed(team: string): number {
    return this.g.get(team) ?? 0;
  }

  /**
   * Apply between-season reversion the first time a team appears in a new season.
   * Must be called for both teams BEFORE reading a prediction, so ratings are as
   * of kickoff.
   */
  touch(team: string, season: number): void {
    const last = this.lastSeason.get(team);
    if (last !== undefined && season > last) {
      const cur = this.rating(team);
      this.r.set(team, this.opts.start + (cur - this.opts.start) * (1 - this.opts.revert));
    }
    this.lastSeason.set(team, season);
  }

  /** P(home team wins), HFA included. */
  winProbHome(home: string, away: string): number {
    const diff = this.rating(home) - this.rating(away) + this.opts.hfa;
    return 1 / (1 + Math.pow(10, -diff / 400));
  }

  /** Model's expected home margin in points (negative = away favored). */
  expectedHomeMargin(home: string, away: string): number {
    const diff = this.rating(home) - this.rating(away) + this.opts.hfa;
    return diff / this.opts.pointsPerElo;
  }

  /** Update both ratings from a final result (home margin = homeScore − awayScore). */
  update(home: string, away: string, homeMargin: number): void {
    const rHome = this.rating(home);
    const rAway = this.rating(away);
    const diff = rHome - rAway + this.opts.hfa; // home perspective, HFA-adjusted
    const expHome = 1 / (1 + Math.pow(10, -diff / 400));
    const scoreHome = homeMargin > 0 ? 1 : homeMargin < 0 ? 0 : 0.5;

    // 538 margin-of-victory multiplier: bigger wins move more, but damped when a
    // strong favorite blows out a weak dog (autocorrelation guard).
    const eloDiffWinner = homeMargin > 0 ? diff : -diff;
    const mov =
      Math.log(Math.abs(homeMargin) + 1) * (2.2 / (eloDiffWinner * 0.001 + 2.2));

    const shift = this.opts.k * mov * (scoreHome - expHome);
    this.r.set(home, rHome + shift);
    this.r.set(away, rAway - shift);
    this.g.set(home, this.gamesPlayed(home) + 1);
    this.g.set(away, this.gamesPlayed(away) + 1);
  }
}
