/**
 * Shared walk-forward sample collection for the NFL SRS model — factored out of
 * `scripts/backtest-nfl-srs.ts` so `scripts/matchup-nfl-context.ts` (the
 * investigate-before-wire study for weather/rest/schedule-spot/division
 * signals) can replay the EXACT same lookahead-safe walk-forward pass rather
 * than a second, potentially-drifting reimplementation. Every sample carries
 * the raw game context (weather, rest, weekday, div_game) alongside the SRS
 * model's own prediction, so a candidate signal's residual regression and the
 * CLV backtest both work off one shared, consistent replay.
 */
import type { NflGame } from "../games";
import { toCompletedGames } from "./historicalGames";
import { buildTeamRatings, ratingOrDefault } from "./ratings";
import { predictGame } from "./model";
import type { NflGamePrediction, NflTeamRating } from "./types";

export interface WalkForwardSample {
  season: number;
  gameId: string;
  home: string;
  away: string;
  neutralSite: boolean;
  actualMargin: number;
  actualTotal: number;
  pred: NflGamePrediction;
  homeRating: NflTeamRating;
  awayRating: NflTeamRating;
  weekday: string;
  gametime: string | null;
  roof: string;
  temp: number | null;
  wind: number | null;
  awayRest: number | null;
  homeRest: number | null;
  divGame: boolean;
  spreadLine: number | null;
  totalLine: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

/** Groups a chronologically-sorted, already-REG-filtered game list by season+week, preserving chronological group order. */
function groupByWeek(games: readonly NflGame[]): NflGame[][] {
  const byKey = new Map<string, NflGame[]>();
  const order: string[] = [];
  for (const g of games) {
    const key = `${g.season}_${g.week}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(g);
  }
  return order.map((k) => byKey.get(k)!);
}

/** Standard empirical HFA estimate: mean home margin over non-neutral games in the given (already season-filtered) set. Kept separate from `collectWalkForwardSamples` since it needs no ratings solver at all — a direct raw-data computation, typically run on a train-window slice before that walk-forward pass uses the result. */
export function fitHomeFieldPoints(games: readonly NflGame[]): number {
  const nonNeutral = games.filter((g) => !g.neutralSite && g.homeScore !== null && g.awayScore !== null);
  return nonNeutral.reduce((sum, g) => sum + (g.homeScore! - g.awayScore!), 0) / nonNeutral.length;
}

/**
 * Walk-forward: rebuild ratings once per NFL week (that week's own earliest
 * kickoff as the cutoff — lookahead-safe regardless of which day within the
 * week a given game falls on), predict every game that week with the ratings
 * built from strictly-prior weeks, then advance. `minGames` gates out games
 * where either side doesn't have enough rating history yet (mirrors the
 * existing Elo backtest's own MIN_GAMES=8 "seen" gate, for comparability).
 */
export function collectWalkForwardSamples(
  allGames: readonly NflGame[],
  opts: { startSeason: number; minGames: number; homeFieldPoints: number }
): WalkForwardSample[] {
  const completed = toCompletedGames(allGames); // full history — ratings.ts filters by as-of cutoff itself

  const reg = allGames
    .filter((g) => g.gameType === "REG" && g.result !== null && g.homeScore !== null && g.awayScore !== null)
    .filter((g) => g.season >= opts.startSeason)
    .sort((x, y) => x.date.getTime() - y.date.getTime());

  const weeks = groupByWeek(reg);
  const samples: WalkForwardSample[] = [];
  for (const weekGames of weeks) {
    const asOfUtc = new Date(Math.min(...weekGames.map((g) => g.date.getTime())));
    const { ratings, leagueAvgPoints } = buildTeamRatings(completed, asOfUtc, opts.homeFieldPoints);
    for (const g of weekGames) {
      const homeRating = ratingOrDefault(ratings, g.home);
      const awayRating = ratingOrDefault(ratings, g.away);
      if (Math.min(homeRating.gamesPlayed, awayRating.gamesPlayed) < opts.minGames) continue;
      const pred = predictGame(homeRating, awayRating, leagueAvgPoints, {
        neutralSite: g.neutralSite,
        homeFieldPoints: opts.homeFieldPoints,
      });
      samples.push({
        season: g.season,
        gameId: g.gameId,
        home: g.home,
        away: g.away,
        neutralSite: g.neutralSite,
        actualMargin: g.result!,
        actualTotal: g.homeScore! + g.awayScore!,
        pred,
        homeRating,
        awayRating,
        weekday: g.weekday,
        gametime: g.gametime,
        roof: g.roof,
        temp: g.temp,
        wind: g.wind,
        awayRest: g.awayRest,
        homeRest: g.homeRest,
        divGame: g.divGame,
        spreadLine: g.spreadLine,
        totalLine: g.totalLine,
        homeMoneyline: g.homeMoneyline,
        awayMoneyline: g.awayMoneyline,
      });
    }
  }
  return samples;
}
