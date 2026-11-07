/**
 * Pulls ESPN's free book prices (espnOdds.ts) onto our games: NBA, NFL and MLB
 * into the same CurrentOddsLine / OddsSnapshot rows every feed writes, and
 * every ESPN league in the all-sports engine into SportEventLine - so boards
 * carry a real price with no odds key, and a paid feed only adds books.
 *
 * The ESPN book's own rows are retired when its line moves. Another feed's
 * prices on the same game stay while they're current, and are retired once
 * they're STALE_OTHER_FEED_MS old: a paid feed that has stopped (out of
 * credits) would otherwise leave days-old numbers on the board, and two stale
 * books outvote the live one in every consensus (on 2026-11-05 JAX @ BAL read
 * a 3-point spread from FanDuel and BetRivers rows four days old, with
 * DraftKings at JAX -10). Their history stays in OddsSnapshot.
 */
import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc, etDateOf } from "@/lib/dateEt";
import type { Sport } from "@/generated/prisma/client";
import type { TeamLeague } from "@/lib/teamLeague/league";
import { storeBookmakerOdds } from "./storeOdds";
import { pickcenterToBookmaker, scoreboardOddsToBookmaker, type EspnPickcenter, type EspnScoreboardOdds } from "./espnOdds";
import { writeOutcomeStatus } from "@/lib/pollingPolicy";
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

export interface ScoreboardFetch {
  events: ScoreboardEvent[];
  /** True when ESPN could not be read at all (HTTP error or network failure) -
   *  deliberately distinct from a successful fetch of an empty slate, which is
   *  a legitimate off-day. The silent version of this distinction (any failure
   *  mapped to []) froze the boards behind an "ok" stamp in Oct-Nov 2026. */
  failed: boolean;
  status?: number;
}

/** One scoreboard fetch, with failure kept visible instead of flattened to []. */
export async function fetchScoreboard(path: string, day: string): Promise<ScoreboardFetch> {
  try {
    const res = await fetch(`${BASE}/${path}/scoreboard?dates=${day}&limit=500`, { headers: { Accept: "application/json" } });
    if (!res.ok) return { events: [], failed: true, status: res.status };
    return { events: ((await res.json()) as { events?: ScoreboardEvent[] }).events ?? [], failed: false };
  } catch {
    return { events: [], failed: true };
  }
}

const yyyymmdd = (d: Date) => etDateOf(d).replace(/-/g, "");

export interface EspnRunSection {
  label: string;
  games: number;
  priced: number;
  feedFailures: number;
  error?: string;
}

/**
 * The espn-odds job's status line, classified with the same antidote the keyed
 * polls use (writeOutcomeStatus): work that landed nothing is an error, a
 * legitimate empty slate is not, and any section whose feed failed outright -
 * or whose job threw - is named in an "error:" prefix instead of being buried
 * inside an "ok:" JSON blob (the Oct-Nov 2026 silent-freeze shape).
 */
export function espnOddsStatus(sections: EspnRunSection[], extraWritten: number): string {
  const considered = sections.reduce((a, s) => a + s.games, 0);
  const written = sections.reduce((a, s) => a + s.priced, 0) + extraWritten;
  const failures: string[] = [];
  for (const s of sections) {
    if (s.error) failures.push(`${s.label} threw: ${s.error}`);
    else if (s.feedFailures > 0) failures.push(`${s.label} feed failed x${s.feedFailures}`);
  }
  const base = writeOutcomeStatus(considered, written, "priced games/lines");
  return failures.length ? `error: ${failures.join("; ")} - ${base}` : base;
}

export interface EspnOddsSummary {
  games: number;
  priced: number;
  unmatched: string[];
  /** Scoreboard fetches that failed outright (HTTP/network) during this run. */
  feedFailures: number;
}

/** Longer than the gap between a paid feed's runs (twice a day), so a working feed's rows are never caught. */
export const STALE_OTHER_FEED_MS = 18 * 3_600_000;

/** One book's prices onto one game, retiring that book's older rows and any other feed's stale ones. */
async function storeForGame(gameId: string, home: string, away: string, bm: NonNullable<ReturnType<typeof scoreboardOddsToBookmaker>>) {
  const startedAt = new Date();
  const n = await storeBookmakerOdds(gameId, home, away, [bm], { retireStale: false });
  await prisma.currentOddsLine.deleteMany({ where: { gameId, bookKey: bm.key, isAlternate: false, polledAt: { lt: startedAt } } });
  await prisma.currentOddsLine.deleteMany({ where: { gameId, bookKey: { not: bm.key }, polledAt: { lt: new Date(startedAt.getTime() - STALE_OTHER_FEED_MS) } } });
  await prisma.gameMarketLine.deleteMany({ where: { gameId, polledAt: { lt: new Date(startedAt.getTime() - STALE_OTHER_FEED_MS) } } });
  return n;
}

/** NBA / NFL: scoreboard odds for the next `days` days onto the matching games. */
export async function pollEspnOddsTeamLeague(league: TeamLeague, days: number, now = new Date()): Promise<EspnOddsSummary> {
  const out: EspnOddsSummary = { games: 0, priced: 0, unmatched: [], feedFailures: 0 };
  for (let d = 0; d < days; d++) {
    const sb = await fetchScoreboard(league.espnPath, yyyymmdd(new Date(now.getTime() + d * 86_400_000)));
    if (sb.failed) out.feedFailures++;
    for (const e of sb.events) {
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
      // Every row the schedule holds for this matchup: a feed can list a game twice, and a copy ESPN never prices keeps a dead feed's lines.
      const games = await prisma.game.findMany({ where: { sport: league.sport, scheduledStartUtc: { gte, lt }, homeTeam: { name: home.name }, awayTeam: { name: away.name } }, select: { id: true } });
      const bm = scoreboardOddsToBookmaker(odds, home.name, away.name);
      if (!games.length || !bm) continue;
      let stored = 0;
      for (const game of games) stored += await storeForGame(game.id, home.name, away.name, bm);
      if (stored > 0) out.priced++;
    }
  }
  await retireStaleLines(league.sport, now, days);
  return out;
}

/**
 * Every upcoming game in the sport, not only the ones ESPN priced this run: a
 * stopped feed's lines older than STALE_OTHER_FEED_MS come off the board.
 */
async function retireStaleLines(sport: Sport, now: Date, days: number) {
  const cutoff = new Date(now.getTime() - STALE_OTHER_FEED_MS);
  const game = { sport, status: { not: "final" as const }, scheduledStartUtc: { gte: now, lte: new Date(now.getTime() + days * 86_400_000) } };
  await prisma.currentOddsLine.deleteMany({ where: { polledAt: { lt: cutoff }, game } });
  await prisma.gameMarketLine.deleteMany({ where: { polledAt: { lt: cutoff }, game } });
}

/** MLB: same, matching on the full team names the schedule sync stores. */
export async function pollEspnOddsMlb(days: number, now = new Date()): Promise<EspnOddsSummary> {
  const out: EspnOddsSummary = { games: 0, priced: 0, unmatched: [], feedFailures: 0 };
  for (let d = 0; d < days; d++) {
    const sb = await fetchScoreboard("baseball/mlb", yyyymmdd(new Date(now.getTime() + d * 86_400_000)));
    if (sb.failed) out.feedFailures++;
    for (const e of sb.events) {
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
  await retireStaleLines("mlb", now, days);
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

export interface LeagueOddsResult {
  lines: number;
  /** Scoreboard fetches that failed outright (HTTP/network) during this run. */
  feedFailures: number;
}

/** All-sports, US-style leagues: scoreboard odds onto the ESPN events (ids "espn:<id>"). */
export async function storeScoreboardOddsForLeague(espnPath: string, days: number, now = new Date()): Promise<LeagueOddsResult> {
  let n = 0;
  let feedFailures = 0;
  for (let d = 0; d < days; d++) {
    const sb = await fetchScoreboard(espnPath, yyyymmdd(new Date(now.getTime() + d * 86_400_000)));
    if (sb.failed) feedFailures++;
    for (const e of sb.events) {
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
  return { lines: n, feedFailures };
}

/**
 * Soccer: its scoreboard carries no prices, each match's summary does. The
 * soonest matches first, at most `max` summaries, each refreshed at most every
 * `everyMinutes`.
 */
export async function storeSoccerPickcenterOdds(max: number, everyMinutes: number, deadline: number, now = new Date()): Promise<LeagueOddsResult> {
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
  let feedFailures = 0;
  for (const ev of events) {
    if (Date.now() > deadline) break;
    let res: Response;
    try {
      res = await fetch(`${BASE}/${ev.league.espnPath}/summary?event=${ev.id.slice(5)}`, { headers: { Accept: "application/json" } });
    } catch {
      feedFailures++;
      continue;
    }
    if (!res.ok) {
      feedFailures++;
      continue;
    }
    const body = (await res.json()) as { pickcenter?: EspnPickcenter[] };
    const bm = pickcenterToBookmaker(body.pickcenter?.[0], ev.home, ev.away);
    if (bm) n += await storeEventLines(ev.id, ev.home, ev.away, bm);
    else await prisma.sportEvent.update({ where: { id: ev.id }, data: { lastOddsAt: now } }); // checked; nothing posted yet
  }
  return { lines: n, feedFailures };
}
