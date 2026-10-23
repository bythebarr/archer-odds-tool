/**
 * Matchup context for a prop, kept pure and client-safe: how much the opponent
 * gives up in the stat (per game, ranked across the league) and how fast its
 * games run. Built from the same box scores as the hit rates, so it needs no
 * extra feed.
 *
 * Team totals are per-game averages of the opponent's box-score sums. Every
 * prop stat is a sum of logged columns, so the stat of the average equals the
 * average of the stat: one NbaStatLine per team covers every stat, combos
 * included.
 */
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStatDef, NbaStatLine } from "./propStats";

export interface TeamDefenseRow {
  /** Games in the sample. */
  games: number;
  /** What opponents average against this team, per game. */
  allowed: NbaStatLine;
  /** Both teams' points per game in this team's games — a pace proxy. */
  combinedPoints: number;
}

export interface DefenseTable {
  /** Season the rows come from; last season's while this one is too young to read. */
  season: number;
  fromLastSeason: boolean;
  teams: Record<string, TeamDefenseRow>;
}

export interface StatMatchup {
  perGame: number;
  leagueAvg: number;
  /** 1 = gives up the most. */
  rank: number;
  of: number;
  games: number;
}

/** How the opponent defends one stat: per game, league average, and rank (1 = most allowed). */
export function statMatchup(table: DefenseTable, opponent: string, stat: NbaPropStatDef): StatMatchup | null {
  const row = table.teams[opponent];
  if (!row) return null;
  const all = Object.values(table.teams).map((t) => stat.value(t.allowed));
  const perGame = stat.value(row.allowed);
  return {
    perGame,
    leagueAvg: all.reduce((a, b) => a + b, 0) / all.length,
    rank: 1 + all.filter((v) => v > perGame).length,
    of: all.length,
    games: row.games,
  };
}

/** Pace by combined points: 1 = highest-scoring games. */
export function paceRank(table: DefenseTable, team: string): { combinedPoints: number; rank: number; of: number } | null {
  const row = table.teams[team];
  if (!row) return null;
  const all = Object.values(table.teams).map((t) => t.combinedPoints);
  return { combinedPoints: row.combinedPoints, rank: 1 + all.filter((v) => v > row.combinedPoints).length, of: all.length };
}

export type MatchupGrade = "great" | "good" | "neutral" | "tough" | "bad";

/**
 * A rank read for the chosen side. For an Over, a defense that gives up a lot
 * (rank near 1) is the good draw; for an Under it's the reverse. Thirds of the
 * league, with the outer fifth called out.
 */
export function matchupGrade(rank: number, of: number, side: PropDirection): MatchupGrade {
  const pct = (rank - 1) / Math.max(of - 1, 1); // 0 = gives up the most
  const forSide = side === "over" ? pct : 1 - pct;
  if (forSide <= 0.2) return "great";
  if (forSide <= 0.34) return "good";
  if (forSide < 0.66) return "neutral";
  if (forSide < 0.8) return "tough";
  return "bad";
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
