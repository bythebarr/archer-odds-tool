/**
 * The book prop-lines board: every league with lines in EventPropLine (the
 * ESPN prop feed), its upcoming events, and one event's lines grouped per
 * player (see props/propBoard).
 */
import { prisma } from "@/lib/prisma";
import { groupPropBoard, type BoardPlayer } from "@/lib/props/propBoard";

export interface BoardLeague {
  path: string;
  name: string;
  events: number;
}

export interface BoardEvent {
  espnEventId: string;
  startsAt: string;
  label: string;
  lines: number;
}

const NAMES: Record<string, string> = {
  "basketball/nba": "NBA",
  "football/nfl": "NFL",
  "hockey/nhl": "NHL",
  "baseball/mlb": "MLB",
  "mma/ufc": "UFC",
  "football/college-football": "College Football",
  "basketball/mens-college-basketball": "College Basketball",
  "basketball/wnba": "WNBA",
};

export async function propBoardLeagues(now = new Date()): Promise<BoardLeague[]> {
  const since = new Date(now.getTime() - 3 * 3_600_000);
  const rows = await prisma.eventPropLine.groupBy({ by: ["league", "espnEventId"], where: { startsAt: { gte: since } } });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.league, (counts.get(r.league) ?? 0) + 1);
  const named = await prisma.league.findMany({ where: { espnPath: { in: [...counts.keys()] } }, select: { espnPath: true, name: true } });
  const nameOf = new Map(named.map((l) => [l.espnPath!, l.name]));
  return [...counts.entries()]
    .map(([path, events]) => ({ path, name: NAMES[path] ?? nameOf.get(path) ?? path, events }))
    .sort((a, b) => (NAMES[a.path] ? 0 : 1) - (NAMES[b.path] ? 0 : 1) || b.events - a.events);
}

export async function propBoardEvents(league: string, now = new Date()): Promise<BoardEvent[]> {
  const since = new Date(now.getTime() - 3 * 3_600_000);
  const rows = await prisma.eventPropLine.groupBy({ by: ["espnEventId", "startsAt", "eventRef", "eventName"], where: { league, startsAt: { gte: since } }, _count: true, orderBy: { startsAt: "asc" } });
  const refs = rows.map((r) => r.eventRef).filter((r): r is string => !!r);
  const [events, games] = await Promise.all([
    prisma.sportEvent.findMany({ where: { id: { in: refs } }, select: { id: true, home: true, away: true } }),
    prisma.game.findMany({ where: { id: { in: refs } }, select: { id: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } }),
  ]);
  const label = new Map<string, string>([
    ...events.map((e) => [e.id, `${e.away} @ ${e.home}`] as const),
    ...games.map((g) => [g.id, `${g.awayTeam?.name ?? "?"} @ ${g.homeTeam?.name ?? "?"}`] as const),
  ]);
  return rows.map((r) => ({ espnEventId: r.espnEventId, startsAt: r.startsAt.toISOString(), label: (r.eventRef && label.get(r.eventRef)) || r.eventName || `Event ${r.espnEventId}`, lines: r._count }));
}

export async function propBoardFor(espnEventId: string): Promise<BoardPlayer[]> {
  const rows = await prisma.eventPropLine.findMany({
    where: { espnEventId },
    select: { athleteId: true, athleteName: true, market: true, statKey: true, period: true, side: true, point: true, bookKey: true, priceAmerican: true },
  });
  return groupPropBoard(rows);
}
