/**
 * NFL matchup context, client-safe and pure: per opponent, what each position
 * group (QB / RB / WR / TE) produces against it per game, ranked across the
 * league. The NBA defense table (src/lib/nba/matchup.ts) for football — every
 * prop stat is a sum of logged columns, so one stat line per group covers them
 * all.
 */
import type { NflPropStatDef, NflStatLine } from "./propStats";

export type NflPosition = "QB" | "RB" | "WR" | "TE";

export interface NflPositionDefense {
  games: number;
  allowed: NflStatLine;
}

export interface NflDefenseTable {
  season: number;
  fromLastSeason: boolean;
  teams: Record<string, { games: number; byPosition: Partial<Record<NflPosition, NflPositionDefense>> }>;
}

export interface NflStatMatchup {
  position: NflPosition;
  perGame: number;
  leagueAvg: number;
  /** 1 = gives up the most. */
  rank: number;
  of: number;
}

/** Below this many games, a team's read against a position isn't ranked. */
export const MIN_NFL_DEFENSE_GAMES = 3;

/** What `opponent` allows to `position` in `stat`, ranked (1 = most allowed). Null without enough games. */
export function nflStatMatchup(table: NflDefenseTable, opponent: string, stat: NflPropStatDef, position: NflPosition | null): NflStatMatchup | null {
  // Kicking and defense aren't read against what a defense allows, and the
  // columns that can be missing aren't summed into the table.
  if (!position || stat.group === "K" || stat.group === "DEF" || stat.available) return null;
  const mine = table.teams[opponent]?.byPosition[position];
  if (!mine || mine.games < MIN_NFL_DEFENSE_GAMES) return null;
  const all = Object.values(table.teams).flatMap((t) => {
    const p = t.byPosition[position];
    return p && p.games >= MIN_NFL_DEFENSE_GAMES ? [stat.value(p.allowed)] : [];
  });
  const perGame = stat.value(mine.allowed);
  return {
    position,
    perGame,
    leagueAvg: all.reduce((a, b) => a + b, 0) / all.length,
    rank: 1 + all.filter((v) => v > perGame).length,
    of: all.length,
  };
}
