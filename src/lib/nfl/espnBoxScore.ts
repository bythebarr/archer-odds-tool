/**
 * ESPN's NFL box score → one stat line per player. Same summary endpoint and
 * the same "find columns by name" rule as the NBA parser (espnBoxScore.ts):
 * each team block carries one table per category (passing, rushing,
 * receiving, …), each with `keys` and a parallel `stats` array per athlete.
 * A player appears once per category he recorded; we merge them into one
 * line, so a QB who scrambles has both his passing and rushing.
 */
import type { NflStatLine } from "./propStats";

const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

export interface EspnNflPlayerLine extends NflStatLine {
  espnAthleteId: string;
  name: string;
  /** ESPN position abbreviation when the box score lists one (QB, RB, WR, TE). */
  position: string | null;
  teamName: string;
}

interface Category {
  name?: string;
  keys?: string[];
  athletes?: { athlete?: { id?: string; displayName?: string; position?: { abbreviation?: string } }; stats?: string[] }[];
}

interface SummaryResponse {
  boxscore?: { players?: { team?: { displayName?: string }; statistics?: Category[] }[] };
}

/** "18/27" → [18, 27]; "312" → [312]; anything else → []. */
function ints(raw: string | undefined): number[] {
  if (raw === undefined) return [];
  return raw.split(/[/-]/).map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
}

function empty(): NflStatLine {
  return {
    passAttempts: 0,
    passCompletions: 0,
    passYards: 0,
    passTds: 0,
    interceptions: 0,
    rushAttempts: 0,
    rushYards: 0,
    rushTds: 0,
    receptions: 0,
    targets: 0,
    recYards: 0,
    recTds: 0,
    rushLongest: null,
    recLongest: null,
    fieldGoalsMade: null,
    extraPointsMade: null,
    kickingPoints: null,
    tackles: null,
    soloTackles: null,
    sacks: null,
  };
}

/** A column's number, or null when the table doesn't carry that key. */
function opt(stats: string[], keys: string[], key: string): number | null {
  const i = keys.indexOf(key);
  if (i < 0) return null;
  const v = Number(stats[i]);
  return Number.isFinite(v) ? v : null;
}

/** Per category: which key fills which column. Composite keys ("completions/passingAttempts") fill two. */
const READERS: Record<string, (stats: string[], keys: string[], line: NflStatLine) => void> = {
  passing: (stats, keys, line) => {
    const at = (k: string) => stats[keys.indexOf(k)];
    const [cmp, att] = ints(at("completions/passingAttempts"));
    if (cmp !== undefined) line.passCompletions = cmp;
    if (att !== undefined) line.passAttempts = att;
    line.passYards = ints(at("passingYards"))[0] ?? 0;
    line.passTds = ints(at("passingTouchdowns"))[0] ?? 0;
    line.interceptions = ints(at("interceptions"))[0] ?? 0;
  },
  rushing: (stats, keys, line) => {
    const at = (k: string) => stats[keys.indexOf(k)];
    line.rushAttempts = ints(at("rushingAttempts"))[0] ?? 0;
    line.rushYards = ints(at("rushingYards"))[0] ?? 0;
    line.rushTds = ints(at("rushingTouchdowns"))[0] ?? 0;
    line.rushLongest = opt(stats, keys, "longRushing");
  },
  receiving: (stats, keys, line) => {
    const at = (k: string) => stats[keys.indexOf(k)];
    line.receptions = ints(at("receptions"))[0] ?? 0;
    line.recYards = ints(at("receivingYards"))[0] ?? 0;
    line.recTds = ints(at("receivingTouchdowns"))[0] ?? 0;
    line.targets = ints(at("receivingTargets"))[0] ?? 0;
    line.recLongest = opt(stats, keys, "longReception");
  },
  kicking: (stats, keys, line) => {
    const fg = ints(stats[keys.indexOf("fieldGoalsMade/fieldGoalAttempts")]);
    const xp = ints(stats[keys.indexOf("extraPointsMade/extraPointAttempts")]);
    line.fieldGoalsMade = fg[0] ?? null;
    line.extraPointsMade = xp[0] ?? null;
    line.kickingPoints = opt(stats, keys, "totalKickingPoints");
  },
  defensive: (stats, keys, line) => {
    line.tackles = opt(stats, keys, "totalTackles");
    line.soloTackles = opt(stats, keys, "soloTackles");
    line.sacks = opt(stats, keys, "sacks");
  },
};

/** The key each category must carry before we trust its table. */
const REQUIRED_KEY: Record<string, string> = {
  passing: "passingYards",
  rushing: "rushingYards",
  receiving: "receivingYards",
  kicking: "totalKickingPoints",
  defensive: "totalTackles",
};

/** Parses one summary payload. Exported for tests against a captured payload. */
export function parseNflBoxScore(payload: unknown): { lines: EspnNflPlayerLine[]; rejected: string[] } {
  const body = payload as SummaryResponse | null | undefined;
  const byId = new Map<string, EspnNflPlayerLine>();
  const rejected: string[] = [];

  for (const block of body?.boxscore?.players ?? []) {
    const teamName = block.team?.displayName;
    if (!teamName) continue;
    for (const cat of block.statistics ?? []) {
      const name = cat.name ?? "";
      const read = READERS[name];
      if (!read) continue; // punting, returns, fumbles… not prop stats
      const keys = cat.keys ?? [];
      if (!keys.includes(REQUIRED_KEY[name])) {
        rejected.push(`${teamName} ${name}`);
        continue;
      }
      for (const a of cat.athletes ?? []) {
        const id = a.athlete?.id;
        const playerName = a.athlete?.displayName;
        if (!id || !playerName || !a.stats?.length) continue;
        const line =
          byId.get(id) ??
          ({ espnAthleteId: id, name: playerName, position: null, teamName, ...empty() } satisfies EspnNflPlayerLine);
        line.position ??= a.athlete?.position?.abbreviation ?? null;
        read(a.stats, keys, line);
        byId.set(id, line);
      }
    }
  }
  return { lines: [...byId.values()], rejected };
}

export async function fetchNflBoxScore(espnEventId: string) {
  const res = await fetch(`${SUMMARY_URL}?event=${espnEventId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN NFL summary ${res.status}`);
  return parseNflBoxScore(await res.json());
}
