import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { espnTeamLogoUrl, nbaHeadshotUrl } from "@/lib/logos";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { packLog, summarizeProp, type GameLogPoint, type PackedLog, type SlateProp } from "@/lib/nba/propsMath";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import type { DefenseTable, TeamDefenseRow } from "@/lib/nba/matchup";
import type { NbaPropStat } from "@/generated/prisma/client";

export interface SlateTeam {
  abbreviation: string;
  name: string;
  logoUrl: string;
}

export interface SlateGame {
  id: string;
  /** ISO string — this crosses the server/client boundary. */
  startUtc: string;
  home: SlateTeam;
  away: SlateTeam;
}

export interface SlatePlayer {
  id: string;
  name: string;
  headshotUrl: string;
  gameId: string;
  /** The player's team in this game; null when their team isn't in it (a trade not yet logged). */
  team: SlateTeam | null;
  opponent: SlateTeam | null;
  venue: "home" | "away" | null;
}

/** Everything the props finder needs for one ET date, in one payload. */
export interface NbaPropsSlate {
  date: string;
  season: number;
  games: SlateGame[];
  players: Record<string, SlatePlayer>;
  /** Player id → game logs before this date, most recent first. */
  logs: Record<string, GameLogPoint[]>;
  props: SlateProp[];
  /** Opponent defense and pace, for the matchup read. */
  defense: DefenseTable;
  lastPolledAt: string | null;
}

/** The slate as sent to the browser: logs packed as tuples (see PackedLog). */
export type WireNbaPropsSlate = Omit<NbaPropsSlate, "logs"> & { logs: Record<string, PackedLog[]> };

export function toWireSlate(slate: NbaPropsSlate): WireNbaPropsSlate {
  return { ...slate, logs: Object.fromEntries(Object.entries(slate.logs).map(([id, logs]) => [id, logs.map(packLog)])) };
}

/** Below this many games a team's season-to-date defense is noise; read last season instead. */
const MIN_DEFENSE_GAMES = 10;

/**
 * Every team's defense and pace from the box scores: per game, what opponents
 * score against it (each prop stat's columns) and both teams' combined points.
 * The current season once teams have played enough games, else last season.
 */
export async function getNbaDefenseTable(season: number): Promise<DefenseTable> {
  const sums = await prisma.nbaPlayerGameLog.groupBy({
    by: ["season", "gameId", "teamId"],
    where: { season: { in: [season - 1, season] } },
    _sum: { points: true, rebounds: true, assists: true, threesMade: true, steals: true, blocks: true },
  });
  const abbr = new Map(
    (await prisma.team.findMany({ where: { id: { in: [...new Set(sums.map((r) => r.teamId))] } }, select: { id: true, abbreviation: true } }))
      .map((t) => [t.id, t.abbreviation])
  );

  const build = (forSeason: number): Record<string, TeamDefenseRow> => {
    const byGame = new Map<string, typeof sums>();
    for (const r of sums) if (r.season === forSeason) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
    const acc = new Map<string, TeamDefenseRow>();
    for (const pair of byGame.values()) {
      if (pair.length !== 2) continue;
      const combined = (pair[0]._sum.points ?? 0) + (pair[1]._sum.points ?? 0);
      for (const [us, them] of [[pair[0], pair[1]], [pair[1], pair[0]]] as const) {
        const key = abbr.get(us.teamId);
        if (!key) continue;
        const row = acc.get(key) ?? {
          games: 0,
          allowed: { points: 0, rebounds: 0, assists: 0, threesMade: 0, steals: 0, blocks: 0 },
          combinedPoints: 0,
        };
        row.games += 1;
        row.combinedPoints += combined;
        for (const k of Object.keys(row.allowed) as (keyof typeof row.allowed)[]) row.allowed[k] += them._sum[k] ?? 0;
        acc.set(key, row);
      }
    }
    // Totals → per-game averages.
    for (const row of acc.values()) {
      row.combinedPoints /= row.games;
      for (const k of Object.keys(row.allowed) as (keyof typeof row.allowed)[]) row.allowed[k] /= row.games;
    }
    return Object.fromEntries(acc);
  };

  const current = build(season);
  const games = Object.values(current).map((t) => t.games).sort((a, b) => a - b);
  const median = games.length ? games[Math.floor(games.length / 2)] : 0;
  if (median >= MIN_DEFENSE_GAMES) return { season, fromLastSeason: false, teams: current };
  const last = build(season - 1);
  return Object.keys(last).length > 0
    ? { season: season - 1, fromLastSeason: true, teams: last }
    : { season, fromLastSeason: false, teams: current };
}

function team(t: { abbreviation: string; name: string } | null): SlateTeam | null {
  return t ? { abbreviation: t.abbreviation, name: t.name, logoUrl: espnTeamLogoUrl("nba", t.abbreviation) } : null;
}

export async function getNbaPropsSlate(dateEt: string): Promise<NbaPropsSlate> {
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const season = NBA_LEAGUE.seasonOf(gte);
  const empty: NbaPropsSlate = {
    date: dateEt,
    season,
    games: [],
    players: {},
    logs: {},
    props: [],
    defense: { season, fromLastSeason: false, teams: {} },
    lastPolledAt: null,
  };

  const games = await prisma.game.findMany({
    where: { sport: "nba", scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  const slateGames = games.flatMap((g) => {
    const home = team(g.homeTeam);
    const away = team(g.awayTeam);
    return home && away ? [{ id: g.id, startUtc: g.scheduledStartUtc.toISOString(), home, away }] : [];
  });
  if (slateGames.length === 0) return empty;

  const lines = await prisma.currentNbaPropLine.findMany({
    where: { gameId: { in: slateGames.map((g) => g.id) } },
    include: { book: { select: { displayName: true } }, nbaPlayer: true },
  });
  if (lines.length === 0) return { ...empty, games: slateGames };

  const gameById = new Map(games.map((g) => [g.id, g]));
  const players: Record<string, SlatePlayer> = {};
  const propsByKey = new Map<string, SlateProp>();
  let lastPolledAt: Date | null = null;

  for (const line of lines) {
    if (!lastPolledAt || line.polledAt > lastPolledAt) lastPolledAt = line.polledAt;
    const p = line.nbaPlayer;
    if (!players[p.id]) {
      const g = gameById.get(line.gameId)!;
      const venue = p.teamId === g.homeTeamId ? "home" : p.teamId === g.awayTeamId ? "away" : null;
      players[p.id] = {
        id: p.id,
        name: p.fullName,
        headshotUrl: nbaHeadshotUrl(p.espnAthleteId),
        gameId: g.id,
        team: venue === "home" ? team(g.homeTeam) : venue === "away" ? team(g.awayTeam) : null,
        opponent: venue === "home" ? team(g.awayTeam) : venue === "away" ? team(g.homeTeam) : null,
        venue,
      };
    }
    const key = `${p.id}:${line.stat}`;
    const prop = propsByKey.get(key) ?? { playerId: p.id, stat: line.stat, quotes: [] };
    prop.quotes.push({
      bookKey: line.bookKey,
      bookName: line.book.displayName,
      side: line.side === "under" ? "under" : "over",
      point: line.point,
      priceAmerican: line.priceAmerican,
    });
    propsByKey.set(key, prop);
  }

  const [history, defense] = await Promise.all([
    prisma.nbaPlayerGameLog.findMany({
      // This season and all of last season: the windows, the season splits and head-to-head.
      where: { nbaPlayerId: { in: Object.keys(players) }, gameDate: { lt: gte }, season: { in: [season - 1, season] } },
    orderBy: { gameDate: "desc" },
      include: { game: { select: { homeTeam: { select: { abbreviation: true } }, awayTeam: { select: { abbreviation: true } } } } },
    }),
    getNbaDefenseTable(season),
  ]);
  const logs: Record<string, GameLogPoint[]> = {};
  for (const h of history) {
    (logs[h.nbaPlayerId] ??= []).push({
      date: etDateOf(h.gameDate),
      opponent: (h.isHome ? h.game.awayTeam?.abbreviation : h.game.homeTeam?.abbreviation) ?? "",
      isHome: h.isHome,
      season: h.season,
      minutes: h.minutes,
      points: h.points,
      rebounds: h.rebounds,
      assists: h.assists,
      threesMade: h.threesMade,
      steals: h.steals,
      blocks: h.blocks,
    });
  }

  return {
    date: dateEt,
    season,
    games: slateGames,
    players,
    logs,
    props: [...propsByKey.values()],
    defense,
    lastPolledAt: lastPolledAt?.toISOString() ?? null,
  };
}

export interface TopProp {
  gameId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string;
  matchup: string;
  stat: NbaPropStat;
  statShort: string;
  side: "over" | "under";
  point: number;
  hits: number;
  sample: number;
  priceAmerican: number;
  bookKey: string;
  bookName: string;
}

/** Stats eligible for the lobby's "top props" strip — the markets members shop most. */
const TOP_PROP_STATS: NbaPropStat[] = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists"];

/**
 * The lobby's "Top props" strip: the day's props with the strongest L10 record
 * at the main line (either side), at least 8 games of sample, one per player.
 * A shortlist to tap into, not a pick — the finder carries every prop.
 */
export async function getTopNbaProps(dateEt: string, limit = 8): Promise<TopProp[]> {
  const slate = await getNbaPropsSlate(dateEt);
  const candidates: TopProp[] = [];
  for (const prop of slate.props) {
    if (!TOP_PROP_STATS.includes(prop.stat)) continue;
    const player = slate.players[prop.playerId];
    const stat = NBA_PROP_STAT_BY_KEY.get(prop.stat);
    if (!player || !stat) continue;
    for (const side of ["over", "under"] as const) {
      const s = summarizeProp(prop, slate.logs[prop.playerId] ?? [], stat, side, { season: slate.season, venue: player.venue, opponent: player.opponent?.abbreviation });
      const best = s && (side === "over" ? s.over : s.under);
      if (!s || !best || s.hitRates.l10.sampleSize < 8) continue;
      candidates.push({
        gameId: player.gameId,
        playerId: player.id,
        playerName: player.name,
        headshotUrl: player.headshotUrl,
        matchup: player.opponent ? `${player.venue === "home" ? "vs" : "@"} ${player.opponent.abbreviation}` : "",
        stat: prop.stat,
        statShort: stat.shortLabel,
        side,
        point: s.point,
        hits: s.hitRates.l10.hits,
        sample: s.hitRates.l10.sampleSize,
        priceAmerican: best.priceAmerican,
        bookKey: best.bookKey,
        bookName: best.bookName,
      });
    }
  }
  candidates.sort((a, b) => b.hits / b.sample - a.hits / a.sample || b.sample - a.sample);
  const seen = new Set<string>();
  return candidates.filter((c) => !seen.has(c.playerId) && seen.add(c.playerId)).slice(0, limit);
}
