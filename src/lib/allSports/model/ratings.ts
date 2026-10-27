/**
 * Ratings for any league, from nothing but its results — the same three engines
 * whatever the sport, picked by family (allSports/sports.ts):
 *
 *   goals  — attack/defense Poisson (soccer/poisson.ts): expected goals each side,
 *            then the full score grid prices 1X2, handicaps, totals, BTTS
 *   points — opponent-adjusted points ratings (gameModel/ratings.ts): expected
 *            score each side, margin and total spreads fitted on the league's own misses
 *   winner — Elo on results: who wins, nothing else
 *
 * League constants (scoring level, home edge) are measured from the history
 * first, so a hockey league isn't priced like soccer. Everything walks forward
 * in date order — a rating never sees the game it's predicting.
 */
import { SoccerPoisson } from "@/lib/soccer/poisson";
import { PointsRatings } from "@/lib/gameModel/ratings";
import type { SportFamily } from "../sports";

export interface Result {
  date: Date;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamForm {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Most recent first, up to five: "W" | "D" | "L". */
  last5: string[];
  /** Per game over the last ten. */
  scored: number | null;
  allowed: number | null;
}

export interface LeagueRatings {
  family: SportFamily;
  /** Expected score each side (goals and points families). */
  expected(home: string, away: string): { home: number; away: number } | null;
  /** The goals family's draw correction (score grid diagonal weight − 1). */
  drawBoost: number;
  /** Home / draw / away chances (draw 0 where there are none). */
  winProbs(home: string, away: string): { home: number; draw: number; away: number };
  /** The team's strength on one readable scale: goal or point differential vs average, or Elo. */
  strength(team: string): number;
  games(team: string): number;
  form(team: string): TeamForm;
  /** Fitted spreads (points family). */
  marginSd: number;
  totalSd: number;
  /** League constants as measured. */
  avgScore: number;
  homeEdge: number;
  results: number;
}

/** Season index: a season runs from July, so Aug–May soccer and Oct–Jun hockey each count as one. */
export function seasonOf(d: Date): number {
  return d.getUTCFullYear() - (d.getUTCMonth() < 6 ? 1 : 0);
}

function formTracker() {
  const log = new Map<string, { r: "W" | "D" | "L"; f: number; a: number }[]>();
  return {
    add(team: string, f: number, a: number) {
      const list = log.get(team) ?? [];
      list.push({ r: f > a ? "W" : f < a ? "L" : "D", f, a });
      log.set(team, list);
    },
    form(team: string): TeamForm {
      const list = log.get(team) ?? [];
      const last10 = list.slice(-10);
      return {
        games: list.length,
        wins: list.filter((x) => x.r === "W").length,
        draws: list.filter((x) => x.r === "D").length,
        losses: list.filter((x) => x.r === "L").length,
        last5: list.slice(-5).reverse().map((x) => x.r),
        scored: last10.length ? last10.reduce((s, x) => s + x.f, 0) / last10.length : null,
        allowed: last10.length ? last10.reduce((s, x) => s + x.a, 0) / last10.length : null,
      };
    },
  };
}

function leagueLevels(results: Result[]) {
  const n = results.length || 1;
  const home = results.reduce((s, r) => s + r.homeScore, 0) / n;
  const away = results.reduce((s, r) => s + r.awayScore, 0) / n;
  return { home, away, avg: (home + away) / 2 };
}

/** Per-sport learning rates, refit by scripts/backtest-all-sports.ts. */
export const GOALS_LR: Record<string, number> = { soccer: 0.06, hockey: 0.006 };
export const POINTS_K: Record<string, number> = { basketball: 0.12, football: 0.15 };

function goalsRatings(results: Result[], sport: string, lr = GOALS_LR[sport] ?? 0.06): LeagueRatings {
  const lv = leagueLevels(results);
  const avg = results.length >= 30 ? lv.avg : sport === "hockey" ? 3 : 1.35;
  // Home edge as a log ratio, shrunk toward a modest prior on small samples.
  const rawEdge = results.length >= 30 && lv.away > 0 ? Math.log(lv.home / lv.away) : 0.2;
  const w = Math.min(1, results.length / 300);
  const homeAdv = Math.max(0, Math.min(0.45, w * rawEdge + (1 - w) * (sport === "hockey" ? 0.08 : 0.22)));
  // Soccer's draw correction is tuned (soccer/poisson.ts); other goal sports draw less often than Poisson already says.
  const drawBoost = sport === "soccer" || sport === "futsal" ? 0.5 : 0.1;
  const model = new SoccerPoisson({
    lr,
    homeAdv,
    baseGoals: Math.log(Math.max(0.2, avg)) - homeAdv / 2,
    seasonRevert: 1 / 3,
    maxGoals: 12,
    drawBoost,
  });
  const forms = formTracker();
  for (const r of results) {
    const season = seasonOf(r.date);
    model.touch(r.home, season);
    model.touch(r.away, season);
    model.update(r.home, r.away, r.homeScore, r.awayScore);
    forms.add(r.home, r.homeScore, r.awayScore);
    forms.add(r.away, r.awayScore, r.homeScore);
  }
  return {
    family: "goals",
    drawBoost,
    expected: (h, a) => {
      const { lh, la } = model.expectedGoals(h, a);
      return { home: lh, away: la };
    },
    winProbs: (h, a) => model.outcomeProbs(h, a),
    strength: (t) => {
      // Goal difference per game vs an average team on a neutral field.
      const { lh, la } = model.expectedGoals(t, "\u0000avg");
      const { lh: lh2, la: la2 } = model.expectedGoals("\u0000avg", t);
      return (lh - la + (la2 - lh2)) / 2;
    },
    games: (t) => model.gamesPlayed(t),
    form: (t) => forms.form(t),
    marginSd: 0,
    totalSd: 0,
    avgScore: avg,
    homeEdge: avg * (Math.exp(homeAdv) - 1),
    results: results.length,
  };
}

function pointsRatings(results: Result[], sport: string, k = POINTS_K[sport] ?? 0.1): LeagueRatings {
  const lv = leagueLevels(results);
  const avg = results.length ? lv.avg : 20;
  const model = new PointsRatings({ k, revert: 0.3, hfa: results.length >= 30 ? lv.home - lv.away : avg * 0.04, leagueAvg: avg, driftK: 0.002 });
  const forms = formTracker();
  let sqM = 0;
  let sqT = 0;
  let n = 0;
  for (const r of results) {
    const season = seasonOf(r.date);
    model.touch(r.home, season);
    model.touch(r.away, season);
    // Spreads are measured only once both teams have a few games behind them.
    if (model.games(r.home) >= 4 && model.games(r.away) >= 4) {
      const e = model.expected(r.home, r.away);
      sqM += (r.homeScore - r.awayScore - (e.home - e.away)) ** 2;
      sqT += (r.homeScore + r.awayScore - (e.home + e.away)) ** 2;
      n++;
    }
    model.update(r.home, r.away, r.homeScore, r.awayScore);
    forms.add(r.home, r.homeScore, r.awayScore);
    forms.add(r.away, r.awayScore, r.homeScore);
  }
  // Without enough history, spreads scale with the scoring level (basketball ~ 0.11×, football ~ 0.6×).
  const fallbackM = Math.max(3, avg * 0.12 + 2);
  const fallbackT = fallbackM * 1.3;
  const shrink = Math.min(1, n / 200);
  return {
    family: "points",
    drawBoost: 0,
    expected: (h, a) => model.expected(h, a),
    winProbs: () => ({ home: NaN, draw: 0, away: NaN }), // filled from the margin distribution (price.ts)
    strength: (t) => model.net(t),
    games: (t) => model.games(t),
    form: (t) => forms.form(t),
    marginSd: n ? shrink * Math.sqrt(sqM / n) + (1 - shrink) * fallbackM : fallbackM,
    totalSd: n ? shrink * Math.sqrt(sqT / n) + (1 - shrink) * fallbackT : fallbackT,
    avgScore: avg,
    homeEdge: model.hfa,
    results: results.length,
  };
}

/** A known starting rating (tennis: the career Elo from the ATP/WTA archive) and how many matches it rests on. */
export type RatingPrior = (name: string) => { rating: number; games: number } | null;

/**
 * Elo with a bigger step for newcomers (their rating should move fast), margins
 * ignored. A prior seeds players the archive already knows; `shrink` pulls the
 * final chance toward 50% where raw Elo is measured overconfident (tennis: 0.75).
 */
function winnerRatings(results: Result[], prior?: RatingPrior, shrink = 1): LeagueRatings {
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  const priorGames = new Map<string, number>();
  const forms = formTracker();
  const r0 = (t: string) => {
    const r = elo.get(t);
    if (r !== undefined) return r;
    const p = prior?.(t);
    if (p) {
      elo.set(t, p.rating);
      priorGames.set(t, p.games);
      return p.rating;
    }
    return 1500;
  };
  const expect = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));
  const shrunk = (p: number) => 1 / (1 + Math.exp(-shrink * Math.log(p / (1 - p))));
  for (const r of results) {
    if (r.homeScore === r.awayScore) continue;
    const a = r0(r.home);
    const b = r0(r.away);
    const e = expect(a, b);
    const s = r.homeScore > r.awayScore ? 1 : 0;
    const k = (t: string) => ((played.get(t) ?? 0) < 15 ? 40 : 24);
    elo.set(r.home, a + k(r.home) * (s - e));
    elo.set(r.away, b - k(r.away) * (s - e));
    played.set(r.home, (played.get(r.home) ?? 0) + 1);
    played.set(r.away, (played.get(r.away) ?? 0) + 1);
    forms.add(r.home, r.homeScore, r.awayScore);
    forms.add(r.away, r.awayScore, r.homeScore);
  }
  return {
    family: "winner",
    drawBoost: 0,
    expected: () => null,
    winProbs: (h, a) => {
      const p = shrunk(expect(r0(h), r0(a)));
      return { home: p, draw: 0, away: 1 - p };
    },
    strength: r0,
    games: (t) => {
      r0(t);
      return (played.get(t) ?? 0) + (priorGames.get(t) ?? 0);
    },
    form: (t) => forms.form(t),
    marginSd: 0,
    totalSd: 0,
    avgScore: 0,
    homeEdge: 0,
    results: results.length,
  };
}

/** Ratings for one league from its results, oldest first. */
export function rateLeague(family: SportFamily, sport: string, results: Result[], opts: { prior?: RatingPrior; shrink?: number; lr?: number } = {}): LeagueRatings {
  const sorted = [...results].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (family === "goals") return goalsRatings(sorted, sport, opts.lr);
  if (family === "points") return pointsRatings(sorted, sport, opts.lr);
  return winnerRatings(sorted, opts.prior, opts.shrink);
}
