/**
 * Opponent-adjusted points ratings — the core of the NBA and NFL game models.
 *
 * Every team carries an offense rating (points it scores above the league
 * average) and a defense rating (points it allows above average). A game's
 * expected score is
 *
 *   home = league + hfa/2 + off[home] + def[away]
 *   away = league − hfa/2 + off[away] + def[home]
 *
 * and after it's played each rating moves by k × the miss — a points-based
 * Elo, so margin AND total come out of one model (Elo alone only knows who
 * wins). Ratings revert toward average between seasons (rosters churn), the
 * league average and home edge drift slowly with the scoring environment, and
 * nothing is read from a game before it has been played.
 */
export interface RatingOpts {
  /** Share of each score miss absorbed by the ratings. */
  k: number;
  /** Share of each rating reverted to average at a new season. */
  revert: number;
  /** Starting home edge, in points (learned slowly from there). */
  hfa: number;
  /** Starting points per team per game (learned slowly from there). */
  leagueAvg: number;
  /** Learning rate for the league average and home edge. */
  driftK: number;
}

export interface ExpectedScore {
  home: number;
  away: number;
}

export class PointsRatings {
  private off = new Map<string, number>();
  private def = new Map<string, number>();
  private played = new Map<string, number>();
  private seasonOf = new Map<string, number>();
  league: number;
  hfa: number;

  constructor(private readonly opts: RatingOpts) {
    this.league = opts.leagueAvg;
    this.hfa = opts.hfa;
  }

  offense(team: string): number {
    return this.off.get(team) ?? 0;
  }
  defense(team: string): number {
    return this.def.get(team) ?? 0;
  }
  games(team: string): number {
    return this.played.get(team) ?? 0;
  }
  /** Net rating: points per game better than an average team on a neutral floor. */
  net(team: string): number {
    return this.offense(team) - this.defense(team);
  }

  /** Applies the between-season reversion the first time a team appears in a new season. */
  touch(team: string, season: number): void {
    const last = this.seasonOf.get(team);
    if (last !== undefined && season > last) {
      this.off.set(team, this.offense(team) * (1 - this.opts.revert));
      this.def.set(team, this.defense(team) * (1 - this.opts.revert));
    }
    this.seasonOf.set(team, season);
  }

  expected(home: string, away: string, neutral = false): ExpectedScore {
    const edge = neutral ? 0 : this.hfa / 2;
    return {
      home: this.league + edge + this.offense(home) + this.defense(away),
      away: this.league - edge + this.offense(away) + this.defense(home),
    };
  }

  update(home: string, away: string, homePts: number, awayPts: number, neutral = false): void {
    const e = this.expected(home, away, neutral);
    const missHome = homePts - e.home;
    const missAway = awayPts - e.away;
    const k = this.opts.k;
    this.off.set(home, this.offense(home) + k * missHome);
    this.def.set(away, this.defense(away) + k * missHome);
    this.off.set(away, this.offense(away) + k * missAway);
    this.def.set(home, this.defense(home) + k * missAway);
    this.league += this.opts.driftK * ((missHome + missAway) / 2);
    if (!neutral) this.hfa += this.opts.driftK * (missHome - missAway);
    this.played.set(home, this.games(home) + 1);
    this.played.set(away, this.games(away) + 1);
  }
}
