/**
 * How a player has done against teams that play like tonight's opponent. Pure
 * and client-safe.
 *
 * A head-to-head record is a handful of games at most. Teams that defend and
 * play like the opponent give a bigger sample of the same kind of night: the
 * opponent's style is read off the defense table (built from the same box
 * scores as everything else) as a short vector, standardized across the league:
 *
 *   - pace: both teams' points in its games
 *   - what it allows in this stat, team-wide and to the player's position group
 *   - the shape of what it allows: points, rebounds, assists and threes
 *
 * and the k teams closest to it (the opponent itself left out: that's the
 * head-to-head) are its look-alikes. His record and average against them, over
 * the logs on hand (this season and last), is the read.
 */
import type { DefenseTable, TeamDefenseRow } from "./matchup";
import { MIN_POSITION_GAMES } from "./matchup";
import type { NbaPropStatDef } from "./propStats";
import type { PositionGroup } from "./positionGroups";
import type { GameLogPoint } from "./propsMath";
import type { PropDirection } from "@/lib/props/tally";

export const STYLE_NEIGHBORS = 5;
/** Fewer games against the look-alikes than this and the record isn't shown. */
export const MIN_STYLE_GAMES = 4;
/** Only his most recent games against them count. */
const MAX_STYLE_GAMES = 20;
/** A team with fewer games than this has no style yet. */
const MIN_TEAM_GAMES = 5;

interface Feature {
  weight: number;
  value: (row: TeamDefenseRow) => number | null;
}

function features(stat: NbaPropStatDef, group: PositionGroup | null | undefined): Feature[] {
  const out: Feature[] = [
    { weight: 1, value: (r) => r.combinedPoints },
    { weight: 1.5, value: (r) => stat.value(r.allowed) },
    { weight: 0.5, value: (r) => r.allowed.points },
    { weight: 0.5, value: (r) => r.allowed.rebounds },
    { weight: 0.5, value: (r) => r.allowed.assists },
    { weight: 0.5, value: (r) => r.allowed.threesMade },
  ];
  if (group) {
    out.push({
      weight: 1.5,
      value: (r) => {
        const p = r.byPosition[group];
        return p && p.games >= MIN_POSITION_GAMES ? stat.value(p.allowed) : null;
      },
    });
  }
  return out;
}

/** The k teams whose style is closest to `opponent`'s, closest first; empty when the table can't tell. */
export function similarOpponents(
  table: DefenseTable,
  opponent: string,
  stat: NbaPropStatDef,
  group?: PositionGroup | null,
  k = STYLE_NEIGHBORS
): string[] {
  const teams = Object.entries(table.teams).filter(([, r]) => r.games >= MIN_TEAM_GAMES);
  const target = table.teams[opponent];
  if (!target || target.games < MIN_TEAM_GAMES || teams.length <= k) return [];
  // A feature only counts when the opponent and most of the league have it.
  const used = features(stat, group).flatMap((f) => {
    if (f.value(target) === null) return [];
    const xs = teams.map(([, r]) => f.value(r)).filter((x): x is number => x !== null);
    if (xs.length < teams.length * 0.8) return [];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    return sd > 0 ? [{ ...f, mean, sd }] : [];
  });
  if (used.length === 0) return [];
  const z = (f: (typeof used)[number], r: TeamDefenseRow) => {
    const v = f.value(r);
    return v === null ? 0 : (v - f.mean) / f.sd;
  };
  return teams
    .filter(([abbr]) => abbr !== opponent)
    .map(([abbr, r]) => ({ abbr, d: used.reduce((a, f) => a + f.weight * (z(f, r) - z(f, target)) ** 2, 0) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.abbr);
}

export interface StyleRecord {
  /** The look-alike teams, closest first. */
  teams: string[];
  games: number;
  /** Games that cashed on the side at the line. */
  hits: number;
  /** His average against them, and over all his games on hand. */
  avg: number;
  overall: number;
}

/** His record against the opponent's look-alikes at `point`; null with fewer than MIN_STYLE_GAMES of them. */
export function styleRecord(
  logs: GameLogPoint[],
  table: DefenseTable,
  opponent: string | null | undefined,
  stat: NbaPropStatDef,
  group: PositionGroup | null | undefined,
  side: PropDirection,
  point: number
): StyleRecord | null {
  if (!opponent) return null;
  const teams = similarOpponents(table, opponent, stat, group);
  if (teams.length === 0) return null;
  const like = new Set(teams);
  const played = logs.filter((l) => l.minutes > 0);
  const vs = played.filter((l) => like.has(l.opponent)).slice(0, MAX_STYLE_GAMES);
  if (vs.length < MIN_STYLE_GAMES) return null;
  const values = vs.map((l) => stat.value(l));
  const all = played.map((l) => stat.value(l));
  return {
    teams,
    games: vs.length,
    hits: values.filter((v) => (side === "over" ? v > point : v < point)).length,
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    overall: all.reduce((a, b) => a + b, 0) / all.length,
  };
}
