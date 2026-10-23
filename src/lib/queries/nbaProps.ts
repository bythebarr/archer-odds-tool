import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { espnTeamLogoUrl, nbaHeadshotUrl } from "@/lib/logos";
import { NBA_LEAGUE } from "@/lib/nba/league";
import type { GameLogPoint, SlateProp } from "@/lib/nba/propsMath";

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
  lastPolledAt: string | null;
}

/** Enough history for L20 and a 20-game home/away split, plus the whole current season. */
const MIN_HISTORY = 40;

function team(t: { abbreviation: string; name: string } | null): SlateTeam | null {
  return t ? { abbreviation: t.abbreviation, name: t.name, logoUrl: espnTeamLogoUrl("nba", t.abbreviation) } : null;
}

export async function getNbaPropsSlate(dateEt: string): Promise<NbaPropsSlate> {
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const season = NBA_LEAGUE.seasonOf(gte);
  const empty: NbaPropsSlate = { date: dateEt, season, games: [], players: {}, logs: {}, props: [], lastPolledAt: null };

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

  const history = await prisma.nbaPlayerGameLog.findMany({
    // Two seasons back at most: the current season plus last season's tail for L20 in October.
    where: { nbaPlayerId: { in: Object.keys(players) }, gameDate: { lt: gte, gte: new Date(gte.getTime() - 400 * 86_400_000) } },
    orderBy: { gameDate: "desc" },
    include: { game: { select: { homeTeam: { select: { abbreviation: true } }, awayTeam: { select: { abbreviation: true } } } } },
  });
  const logs: Record<string, GameLogPoint[]> = {};
  for (const h of history) {
    const list = (logs[h.nbaPlayerId] ??= []);
    if (list.length >= MIN_HISTORY && h.season !== season) continue;
    list.push({
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
    lastPolledAt: lastPolledAt?.toISOString() ?? null,
  };
}
