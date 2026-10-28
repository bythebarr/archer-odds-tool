/**
 * A tennis player's match log from the archive: each match from his side —
 * result, games and sets, and (where the archive has it) the serve line:
 * aces, double faults, first serves in and won, second serves won, service
 * games, break points saved and faced, and the return games he broke. Pure.
 */

export interface TennisLog {
  /** YYYY-MM-DD */
  date: string;
  season: number;
  opponent: string;
  opponentRank: number | null;
  surface: string | null;
  tournament: string;
  bestOf: number;
  won: boolean;
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  setsLost: number;
  /** Retirement or unfinished: the games stand, but the counts aren't a full match. */
  incomplete: boolean;
  aces: number | null;
  doubleFaults: number | null;
  servePoints: number | null;
  firstIn: number | null;
  firstWon: number | null;
  secondWon: number | null;
  serviceGames: number | null;
  bpSaved: number | null;
  bpFaced: number | null;
  /** His breaks: the opponent's break points faced minus saved. */
  breaks: number | null;
  minutes: number | null;
}

export interface ParsedScore {
  /** Each set, winner's games first. Tiebreaks count as one game. */
  sets: [number, number][];
  retired: boolean;
  walkover: boolean;
}

/** "6-4 7-6(5) 3-6 6-1", "6-3 2-1 RET", "W/O" → games per set from the winner's side. */
export function parseScore(score: string | null | undefined): ParsedScore {
  const s = (score ?? "").trim();
  if (!s || /^w\/?o$/i.test(s) || /walkover/i.test(s)) return { sets: [], retired: false, walkover: true };
  const retired = /\b(RET|DEF|Def\.|ABD|unfinished)\b/i.test(s);
  const sets: [number, number][] = [];
  for (const m of s.matchAll(/(\d+)-(\d+)(?:\(\d+\))?/g)) sets.push([Number(m[1]), Number(m[2])]);
  return { sets, retired, walkover: false };
}

export interface ArchiveMatchRow {
  tourneyDate: Date;
  tourneyName: string;
  surface: string | null;
  bestOf: number | null;
  winnerSackId: string;
  winnerName: string;
  winnerRank: number | null;
  loserSackId: string;
  loserName: string;
  loserRank: number | null;
  score: string | null;
  minutes: number | null;
  winnerAces: number | null;
  winnerDfs: number | null;
  loserAces: number | null;
  loserDfs: number | null;
  winnerSvpt: number | null;
  winnerFirstIn: number | null;
  winnerFirstWon: number | null;
  winnerSecondWon: number | null;
  winnerSvGms: number | null;
  winnerBpSaved: number | null;
  winnerBpFaced: number | null;
  loserSvpt: number | null;
  loserFirstIn: number | null;
  loserFirstWon: number | null;
  loserSecondWon: number | null;
  loserSvGms: number | null;
  loserBpSaved: number | null;
  loserBpFaced: number | null;
}

/** One archive row from `playerId`'s side; null for walkovers and unreadable scores. */
export function toTennisLog(r: ArchiveMatchRow, playerId: string): TennisLog | null {
  const won = r.winnerSackId === playerId;
  if (!won && r.loserSackId !== playerId) return null;
  const p = parseScore(r.score);
  if (p.walkover || !p.sets.length) return null;
  const w = p.sets.reduce((a, [x]) => a + x, 0);
  const l = p.sets.reduce((a, [, y]) => a + y, 0);
  const setsW = p.sets.filter(([x, y]) => x > y).length;
  const setsL = p.sets.filter(([x, y]) => y > x).length;
  const me = won ? "winner" : "loser";
  const them = won ? "loser" : "winner";
  const g = (k: string) => (r as unknown as Record<string, number | null>)[k] ?? null;
  const oppFaced = g(`${them}BpFaced`);
  const oppSaved = g(`${them}BpSaved`);
  return {
    date: r.tourneyDate.toISOString().slice(0, 10),
    season: r.tourneyDate.getUTCFullYear(),
    opponent: won ? r.loserName : r.winnerName,
    opponentRank: won ? r.loserRank : r.winnerRank,
    surface: r.surface,
    tournament: r.tourneyName,
    bestOf: r.bestOf ?? (p.sets.length > 3 ? 5 : 3),
    won,
    gamesWon: won ? w : l,
    gamesLost: won ? l : w,
    setsWon: won ? setsW : setsL,
    setsLost: won ? setsL : setsW,
    incomplete: p.retired,
    aces: g(`${me}Aces`),
    doubleFaults: g(`${me}Dfs`),
    servePoints: g(`${me}Svpt`),
    firstIn: g(`${me}FirstIn`),
    firstWon: g(`${me}FirstWon`),
    secondWon: g(`${me}SecondWon`),
    serviceGames: g(`${me}SvGms`),
    bpSaved: g(`${me}BpSaved`),
    bpFaced: g(`${me}BpFaced`),
    breaks: oppFaced !== null && oppSaved !== null ? oppFaced - oppSaved : null,
    minutes: r.minutes,
  };
}

export type PackedTennisLog = [string, string, number | null, string | null, string, number, 0 | 1, number, number, number, number, 0 | 1, ...(number | null)[]];
const SERVE_FIELDS = ["aces", "doubleFaults", "servePoints", "firstIn", "firstWon", "secondWon", "serviceGames", "bpSaved", "bpFaced", "breaks", "minutes"] as const;

export function packTennisLog(l: TennisLog): PackedTennisLog {
  return [l.date, l.opponent, l.opponentRank, l.surface, l.tournament, l.bestOf, l.won ? 1 : 0, l.gamesWon, l.gamesLost, l.setsWon, l.setsLost, l.incomplete ? 1 : 0, ...SERVE_FIELDS.map((k) => l[k])];
}

export function unpackTennisLog(t: PackedTennisLog): TennisLog {
  const [date, opponent, opponentRank, surface, tournament, bestOf, won, gamesWon, gamesLost, setsWon, setsLost, incomplete, ...rest] = t;
  const serve = Object.fromEntries(SERVE_FIELDS.map((k, i) => [k, rest[i] ?? null])) as Pick<TennisLog, (typeof SERVE_FIELDS)[number]>;
  return { date, season: Number(date.slice(0, 4)), opponent, opponentRank, surface, tournament, bestOf, won: won === 1, gamesWon, gamesLost, setsWon, setsLost, incomplete: incomplete === 1, ...serve };
}
