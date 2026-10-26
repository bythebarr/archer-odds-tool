/**
 * Everything the NFL props finder needs for the week ahead, in one payload —
 * the NBA slate (queries/nbaProps.ts) for football: the games with prop lines,
 * their players, two seasons of game logs (packed for the wire), the current
 * lines, and the defense-by-position table.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { espnTeamLogoUrl } from "@/lib/logos";
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { nflPositionGroup, type NflStatLine } from "@/lib/nfl/propStats";
import type { NflDefenseTable, NflPosition } from "@/lib/nfl/matchup";
import type { NflLogPoint, NflSlateProp } from "@/lib/nfl/propsMath";
import type { SlateGame, SlateTeam } from "./nbaProps";

export interface NflSlatePlayer {
  id: string;
  name: string;
  headshotUrl: string;
  position: NflPosition | null;
  gameId: string;
  team: SlateTeam | null;
  opponent: SlateTeam | null;
  venue: "home" | "away" | null;
}

/** A log as a tuple: [date, opponent, isHome, season, ...the 12 stat columns in NflStatLine order]. */
export type PackedNflLog = [string, string, 0 | 1, number, ...number[]];

const COLUMNS: (keyof NflStatLine)[] = [
  "passAttempts", "passCompletions", "passYards", "passTds", "interceptions",
  "rushAttempts", "rushYards", "rushTds", "receptions", "targets", "recYards", "recTds",
];

export function packNflLog(l: NflLogPoint): PackedNflLog {
  return [l.date, l.opponent, l.isHome ? 1 : 0, l.season, ...COLUMNS.map((c) => l[c])];
}

export function unpackNflLog(t: PackedNflLog): NflLogPoint {
  const [date, opponent, isHome, season, ...rest] = t;
  const line = Object.fromEntries(COLUMNS.map((c, i) => [c, rest[i] ?? 0])) as unknown as NflStatLine;
  return { date, opponent, isHome: isHome === 1, season, ...line };
}

export interface NflPropsSlate {
  season: number;
  games: SlateGame[];
  players: Record<string, NflSlatePlayer>;
  logs: Record<string, PackedNflLog[]>;
  props: NflSlateProp[];
  defense: NflDefenseTable;
  lastPolledAt: string | null;
}

/** ESPN's NFL headshot, keyed by athlete id. */
export function nflHeadshotUrl(espnAthleteId: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnAthleteId}.png&w=192&h=140&scale=crop`;
}

function team(t: { abbreviation: string; name: string } | null): SlateTeam | null {
  return t ? { abbreviation: t.abbreviation, name: t.name, logoUrl: espnTeamLogoUrl("nfl", t.abbreviation) } : null;
}

const MIN_DEFENSE_GAMES = 4;
const STAT_SUMS = Object.fromEntries(COLUMNS.map((c) => [c, true])) as Record<keyof NflStatLine, true>;

/** Per team, what each position group produces against it per game; this season once teams have 4 games, else last. */
export const getNflDefenseTable = cache(async (season: number): Promise<NflDefenseTable> => {
  const sums = await prisma.nflPlayerGameLog.groupBy({
    by: ["season", "gameId", "teamId", "position"],
    where: { season: { in: [season - 1, season] } },
    _sum: STAT_SUMS,
  });
  const abbr = new Map(
    (await prisma.team.findMany({ where: { id: { in: [...new Set(sums.map((r) => r.teamId))] } }, select: { id: true, abbreviation: true } })).map((t) => [t.id, t.abbreviation])
  );
  const zero = (): NflStatLine => Object.fromEntries(COLUMNS.map((c) => [c, 0])) as unknown as NflStatLine;

  const build = (forSeason: number): NflDefenseTable["teams"] => {
    const games = new Map<string, Map<string, Map<NflPosition, NflStatLine>>>();
    for (const r of sums) {
      if (r.season !== forSeason) continue;
      const pos = nflPositionGroup(r.position);
      const teams = games.get(r.gameId) ?? new Map();
      const groups = teams.get(r.teamId) ?? new Map<NflPosition, NflStatLine>();
      if (pos) {
        const line = groups.get(pos) ?? zero();
        for (const c of COLUMNS) line[c] += r._sum[c] ?? 0;
        groups.set(pos, line);
      }
      teams.set(r.teamId, groups);
      games.set(r.gameId, teams);
    }
    const out: NflDefenseTable["teams"] = {};
    for (const teams of games.values()) {
      if (teams.size !== 2) continue;
      const [[idA, a], [idB, b]] = [...teams.entries()];
      for (const [us, them] of [[idA, b], [idB, a]] as const) {
        const key = abbr.get(us);
        if (!key) continue;
        const row = (out[key] ??= { games: 0, byPosition: {} });
        row.games++;
        for (const p of ["QB", "RB", "WR", "TE"] as const) {
          const d = (row.byPosition[p] ??= { games: 0, allowed: zero() });
          d.games++;
          const line = them.get(p);
          if (line) for (const c of COLUMNS) d.allowed[c] += line[c];
        }
      }
    }
    for (const row of Object.values(out)) {
      for (const d of Object.values(row.byPosition)) for (const c of COLUMNS) d.allowed[c] /= d.games;
    }
    return out;
  };

  const current = build(season);
  const counts = Object.values(current).map((t) => t.games).sort((x, y) => x - y);
  if ((counts[Math.floor(counts.length / 2)] ?? 0) >= MIN_DEFENSE_GAMES) return { season, fromLastSeason: false, teams: current };
  const last = build(season - 1);
  return Object.keys(last).length ? { season: season - 1, fromLastSeason: true, teams: last } : { season, fromLastSeason: false, teams: current };
});

/** The coming week's NFL props (games starting from three hours ago through seven days out). */
export const getNflPropsSlate = cache(async (now: Date = new Date()): Promise<NflPropsSlate> => {
  const season = NFL_LEAGUE.seasonOf(now);
  const games = await prisma.game.findMany({
    where: {
      sport: "nfl",
      scheduledStartUtc: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 7 * 86_400_000) },
      currentNflPropLines: { some: {} },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  const empty: NflPropsSlate = { season, games: [], players: {}, logs: {}, props: [], defense: { season, fromLastSeason: false, teams: {} }, lastPolledAt: null };
  if (games.length === 0) return empty;

  const slateGames: SlateGame[] = games.flatMap((g) => {
    const home = team(g.homeTeam);
    const away = team(g.awayTeam);
    return home && away ? [{ id: g.id, startUtc: g.scheduledStartUtc.toISOString(), home, away }] : [];
  });
  const lines = await prisma.currentNflPropLine.findMany({
    where: { gameId: { in: slateGames.map((g) => g.id) } },
    include: { book: { select: { displayName: true } }, nflPlayer: true },
  });

  const byId = new Map(games.map((g) => [g.id, g]));
  const players: Record<string, NflSlatePlayer> = {};
  const props = new Map<string, NflSlateProp>();
  let lastPolledAt: Date | null = null;
  for (const line of lines) {
    if (!lastPolledAt || line.polledAt > lastPolledAt) lastPolledAt = line.polledAt;
    const p = line.nflPlayer;
    if (!players[p.id]) {
      const g = byId.get(line.gameId)!;
      const venue = p.teamId === g.homeTeamId ? "home" : p.teamId === g.awayTeamId ? "away" : null;
      players[p.id] = {
        id: p.id,
        name: p.fullName,
        headshotUrl: nflHeadshotUrl(p.espnAthleteId),
        position: nflPositionGroup(p.position),
        gameId: g.id,
        team: venue === "home" ? team(g.homeTeam) : venue === "away" ? team(g.awayTeam) : null,
        opponent: venue === "home" ? team(g.awayTeam) : venue === "away" ? team(g.homeTeam) : null,
        venue,
      };
    }
    const key = `${p.id}:${line.stat}`;
    const prop = props.get(key) ?? { playerId: p.id, stat: line.stat, quotes: [] };
    prop.quotes.push({ bookKey: line.bookKey, bookName: line.book.displayName, side: line.side === "under" ? "under" : "over", point: line.point, priceAmerican: line.priceAmerican });
    props.set(key, prop);
  }

  const [history, defense] = await Promise.all([
    prisma.nflPlayerGameLog.findMany({
      where: { nflPlayerId: { in: Object.keys(players) }, gameDate: { lt: now }, season: { in: [season - 1, season] } },
      orderBy: { gameDate: "desc" },
      include: { game: { select: { homeTeam: { select: { abbreviation: true } }, awayTeam: { select: { abbreviation: true } } } } },
    }),
    getNflDefenseTable(season),
  ]);
  const logs: Record<string, PackedNflLog[]> = {};
  for (const h of history) {
    const point: NflLogPoint = {
      date: etDateOf(h.gameDate),
      opponent: (h.isHome ? h.game.awayTeam?.abbreviation : h.game.homeTeam?.abbreviation) ?? "",
      isHome: h.isHome,
      season: h.season,
      ...(Object.fromEntries(COLUMNS.map((c) => [c, h[c]])) as unknown as NflStatLine),
    };
    (logs[h.nflPlayerId] ??= []).push(packNflLog(point));
  }

  return { season, games: slateGames, players, logs, props: [...props.values()], defense, lastPolledAt: lastPolledAt?.toISOString() ?? null };
});
