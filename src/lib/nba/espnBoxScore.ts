/**
 * ESPN's public NBA game summary — the box score behind every NBA player game
 * log. Free and unkeyed, the same provider that settles NBA games (see
 * teamLeague/espnScoreboard.ts), addressed by the ESPN event id the scoreboard
 * already returns.
 *
 * Each team block lists its stat columns once (`keys`, with `names` as the older
 * abbreviation form) and every athlete's stats as a parallel string array. The
 * parser finds columns by name rather than by position, and drops a whole team
 * block when a column it needs is missing: a game left without logs is
 * recoverable on the next sync, a game logged with shifted columns would put
 * wrong numbers behind every hit rate.
 */
import type { NbaStatLine } from "./propStats";

const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

export interface EspnNbaPlayerLine extends NbaStatLine {
  espnAthleteId: string;
  name: string;
  headshotUrl: string | null;
  /** ESPN's position abbreviation (PG, SF, C, …), when the box score lists one. */
  position: string | null;
  /** The team's display name as ESPN renders it, e.g. "LA Clippers". */
  teamName: string;
  starter: boolean;
  minutes: number;
  turnovers: number;
}

export interface EspnNbaBoxScore {
  lines: EspnNbaPlayerLine[];
  /** Team blocks dropped because a needed column was missing — reported, never silent. */
  rejectedTeams: string[];
}

interface SummaryResponse {
  boxscore?: {
    players?: {
      team?: { displayName?: string };
      statistics?: {
        keys?: string[];
        names?: string[];
        athletes?: {
          athlete?: { id?: string; displayName?: string; headshot?: { href?: string }; position?: { abbreviation?: string } };
          starter?: boolean;
          didNotPlay?: boolean;
          stats?: string[];
        }[];
      }[];
    }[];
  };
}

/** Each column we read, by its `keys` name and its `names` abbreviation. */
const COLUMNS = {
  minutes: ["minutes", "MIN"],
  points: ["points", "PTS"],
  rebounds: ["rebounds", "REB"],
  assists: ["assists", "AST"],
  threes: ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT"],
  steals: ["steals", "STL"],
  blocks: ["blocks", "BLK"],
  turnovers: ["turnovers", "TO"],
} as const;

type Column = keyof typeof COLUMNS;

function columnIndexes(keys: string[] | undefined, names: string[] | undefined): Record<Column, number> | null {
  const out = {} as Record<Column, number>;
  for (const [column, [key, name]] of Object.entries(COLUMNS) as [Column, readonly [string, string]][]) {
    let index = keys?.indexOf(key) ?? -1;
    if (index < 0) index = names?.indexOf(name) ?? -1;
    if (index < 0) return null;
    out[column] = index;
  }
  return out;
}

/** "7" → 7; "3-8" (made-attempted) → 3; anything else → null. */
function leadingInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = /^\s*(\d+)/.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * Parses one summary payload into player lines. Players who didn't play, or
 * whose minutes read zero, are left out: a book voids a prop on a player who
 * doesn't take the floor, so that game isn't a data point.
 *
 * Exported so it's testable against a captured payload without a network call.
 */
export function parseNbaBoxScore(payload: unknown): EspnNbaBoxScore {
  const body = payload as SummaryResponse | null | undefined;
  const lines: EspnNbaPlayerLine[] = [];
  const rejectedTeams: string[] = [];

  for (const block of body?.boxscore?.players ?? []) {
    const teamName = block.team?.displayName;
    const table = block.statistics?.[0];
    if (!teamName || !table) continue;

    const at = columnIndexes(table.keys, table.names);
    if (!at) {
      rejectedTeams.push(teamName);
      continue;
    }

    for (const entry of table.athletes ?? []) {
      const id = entry.athlete?.id;
      const name = entry.athlete?.displayName;
      const stats = entry.stats ?? [];
      if (!id || !name || entry.didNotPlay || stats.length === 0) continue;

      const read = (column: Column) => leadingInt(stats[at[column]]);
      const minutes = read("minutes");
      if (!minutes) continue; // null (unparseable) or 0 — not a game played

      const values = {
        points: read("points"),
        rebounds: read("rebounds"),
        assists: read("assists"),
        threesMade: read("threes"),
        steals: read("steals"),
        blocks: read("blocks"),
        turnovers: read("turnovers"),
      };
      if (Object.values(values).some((v) => v === null)) continue;

      lines.push({
        espnAthleteId: id,
        name,
        headshotUrl: entry.athlete?.headshot?.href ?? null,
        position: entry.athlete?.position?.abbreviation ?? null,
        teamName,
        starter: entry.starter === true,
        minutes,
        ...(values as Record<keyof typeof values, number>),
      });
    }
  }

  return { lines, rejectedTeams };
}

/** Fetches one game's box score by ESPN event id. Throws on a non-OK response so the caller can count and retry. */
export async function fetchNbaBoxScore(espnEventId: string): Promise<EspnNbaBoxScore> {
  const res = await fetch(`${SUMMARY_URL}?event=${encodeURIComponent(espnEventId)}`);
  if (!res.ok) throw new Error(`ESPN summary ${espnEventId}: ${res.status} ${res.statusText}`);
  return parseNbaBoxScore(await res.json());
}
