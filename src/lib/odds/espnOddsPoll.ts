/**
 * Pulls ESPN's free book prices (espnOdds.ts) onto our games: NBA, NFL and MLB
 * into the same CurrentOddsLine / OddsSnapshot rows every feed writes, and
 * every ESPN league in the all-sports engine into SportEventLine — so boards
 * carry a real price with no odds key, and a paid feed only adds books.
 *
 * Only the ESPN book's own rows are retired when its line moves; another
 * feed's prices on the same game are never touched.
 */
import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc, etDateOf } from "@/lib/dateEt";
import type { Sport } from "@/generated/prisma/client";
import type { TeamLeague } from "@/lib/teamLeague/league";
import { storeBookmakerOdds } from "./storeOdds";
import { pickcenterToBookmaker, scoreboardOddsToBookmaker, type EspnPickcenter, type EspnScoreboardOdds } from "./espnOdds";
import { toaEventLines } from "@/lib/allSports/feeds/toa";
import type { FeedLine } from "@/lib/allSports/feed";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface ScoreboardEvent {
  id: string;
  date: string;
  competitions: {
    status?: { type?: { state?: string } };
    odds?: (EspnScoreboardOdds | null)[] | null;
    competitors: { homeAway: "home" | "away"; team: { displayName: string } }[];
  }[];
}

async function scoreboard(path: string, day: string): Promise<ScoreboardEvent[]> {
  const res = await fetch(`${BASE}/${path}/scoreboard?dates=${day}&limit=500`, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return ((await res.json()) as { events?: ScoreboardEvent[] }).events ?? [];
}

const yyyymmdd = (d: Date) => etDateOf(d).replace(/-/g, "");

export interface EspnOddsSummary {
  games: number;
  priced: number;
  unmatched: string[];
}

/** One book's prices onto one game, retiring only that book's older rows. */
async function storeForGame(gameId: string, home: string, away: string, bm: NonNullable<ReturnType<typeof scoreboardOddsToBookmaker>>) {
  const startedAt = new Date();
  const n = await storeBookmakerOdds(gameId, home, away, [bm], { retireStale: false });
  await prisma.currentOddsLine.deleteMany({ where: { gameId, bookKey: bm.key, isAlternate: false, polledAt: { lt: startedAt } } });
  return n;
}

/** NBA / NFL: scoreboard odds for the next `days` days onto the matching games. */
export async function pollEspnOddsTeamLeague(league: TeamLeague, days: number, now = new Date()): Promise<EspnOddsSummary> {
  const out: EspnOddsSummary = { games: 0, priced: 0, unmatched: [] };
  for (let d = 0; d < days; d++) {
    for (const e of await scoreboard(league.espnPath, yyyymmdd(new Date(now.getTime() + d * 86_400_000)))) {
      const c = e.competitions[0];
      const odds = c?.odds?.find((o) => o) ?? null;
      if (!c || !odds || c.status?.type?.state !== "pre") continue;
      out.games++;
      const homeName = c.competitors.find((x) => x.homeAway === "home")?.team.displayName ?? "";
      const awayName = c.competitors.find((x) => x.homeAway === "away")?.team.displayName ?? "";
      const home = league.lookupTeam(homeName);
      const away = league.lookupTeam(awayName);
      if (!home || !away) {
        out.unmatched.push(`${awayName} @ ${homeName}`);
        continue;
      }
      const { gte, lt } = etDayBoundsUtc(etDateOf(new Date(e.date)));
      const game = await prisma.game.findFirst({ where: { sport: league.sport, scheduledStartUtc: { gte, lt }, homeTeam: { name: home.name }, awayTeam: { name: away.name } } });
      const bm = scoreboardOddsToBookmaker(odds, home.name, away.name);
      if (!game || !bm) continue;
      if ((await storeForGame(game.id, home.name, away.name, bm)) > 0) out.priced++;
    }
  }
  return out;
}

/** MLB: same, matching on the full team names the schedule sync stores. */
export async function pollEspnOddsMlb(days: number, now = new Date()): Promise<EspnOddsSummary> {
  const out: EspnOddsSummary = { games: 0, priced: 0, unmatched: [] };
  for (let d = 0; d < days; d++) {
    for (const e of await scoreboard("baseball/mlb", yyyymmdd(new Date(now.getTime() + d * 86_400_000)))) {
      const c = e.competitions[0];
      const odds = c?.odds?.find((o) => o) ?? null;
      if (!c || !odds || c.status?.type?.state !== "pre") continue;
      out.games++;
      const home = c.competitors.find((x) => x.homeAway === "home")?.team.displayName ?? "";
      const away = c.competitors.find((x) => x.homeAway === "away")?.team.displayName ?? "";
      const start = new Date(e.date);
      const game = await prisma.game.findFirst({
        where: { sport: "mlb" satisfies Sport, scheduledStartUtc: { gte: new Date(start.getTime() - 6 * 3_600_000), lte: new Date(start.getTime() + 6 * 3_600_000) }, homeTeam: { name: home }, awayTeam: { name: away } },
      });
      if (!game) {
        out.unmatched.push(`${away} @ ${home}`);
        continue;
      }
      const bm = scoreboardOddsToBookmaker(odds, home, away);
      if (bm && (await storeForGame(game.id, home, away, bm)) > 0) out.priced++;
    }
  }
  return out;
}

/** An ESPN event's prices as all-sports lines (replacing that event's ESPN-book lines). */
async function storeEventLines(eventId: string, home: string, away: string, bm: NonNullable<ReturnType<typeof scoreboardOddsToBookmaker>>) {
  const lines: FeedLine[] = toaEventLines({ id: eventId, sport_key: "", commence_time: "", home_team: home, away_team: away, bookmakers: [bm] }, false);
  const polledAt = new Date();
  await prisma.$transaction([
    prisma.sportEventLine.deleteMany({ where: { eventId, bookKey: bm.key } }),
    prisma.sportEventLine.createMany({ data: lines.map((l) => ({ eventId, bookKey: l.bookKey, market: l.market, period: l.period, side: l.side, point: l.point, priceAmerican: l.priceAmerican, polledAt })), skipDuplicates: true }),
    prisma.sportEvent.update({ where: { id: eventId }, data: { lastOddsAt: polledAt } }),
  ]);
  return lines.length;
}

/** All-sports, US-style leagues: scoreboard odds onto the ESPN events (ids "espn:<id>"). */
export async function storeScoreboardOddsForLeague(espnPath: string, days: number, now = new Date()): Promise<number> {
  let n = 0;
  for (let d = 0; d < days; d++) {
    for (const e of await scoreboard(espnPath, yyyymmdd(new Date(now.getTime() + d * 86_400_000)))) {
      const c = e.competitions[0];
      const odds = c?.odds?.find((o) => o) ?? null;
      if (!c || !odds) continue;
      const id = `espn:${e.id}`;
      const ev = await prisma.sportEvent.findUnique({ where: { id }, select: { home: true, away: true, status: true } });
      if (!ev || ev.status !== "scheduled") continue;
      const bm = scoreboardOddsToBookmaker(odds, ev.home, ev.away);
      if (bm) n += await storeEventLines(id, ev.home, ev.away, bm);
    }
  }
  return n;
}

/**
 * Soccer: its scoreboard carries no prices, each match's summary does. The
 * soonest matches first, at most `max` summaries, each refreshed at most every
 * `everyMinutes`.
 */
export async function storeSoccerPickcenterOdds(max: number, everyMinutes: number, deadline: number, now = new Date()): Promise<number> {
  const events = await prisma.sportEvent.findMany({
    where: {
      id: { startsWith: "espn:" },
      status: "scheduled",
      startsAt: { gte: now, lte: new Date(now.getTime() + 72 * 3_600_000) },
      league: { sport: "soccer", espnPath: { not: null } },
      OR: [{ lastOddsAt: null }, { lastOddsAt: { lt: new Date(now.getTime() - everyMinutes * 60_000) } }],
    },
    orderBy: { startsAt: "asc" },
    take: max,
    select: { id: true, home: true, away: true, league: { select: { espnPath: true } } },
  });
  let n = 0;
  for (const ev of events) {
    if (Date.now() > deadline) break;
    const res = await fetch(`${BASE}/${ev.league.espnPath}/summary?event=${ev.id.slice(5)}`, { headers: { Accept: "application/json" } });
    if (!res.ok) continue;
    const body = (await res.json()) as { pickcenter?: EspnPickcenter[] };
    const bm = pickcenterToBookmaker(body.pickcenter?.[0], ev.home, ev.away);
    if (bm) n += await storeEventLines(ev.id, ev.home, ev.away, bm);
    else await prisma.sportEvent.update({ where: { id: ev.id }, data: { lastOddsAt: now } }); // checked; nothing posted yet
  }
  return n;
}
