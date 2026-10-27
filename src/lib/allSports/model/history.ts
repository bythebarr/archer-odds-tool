/**
 * A league's results for the ratings: the odds feed's finals plus ESPN's
 * backfill, with ESPN's team names mapped onto the feed's (the names the board
 * prices with) and the same match from both sources counted once.
 *
 * Ratings are rebuilt per league when a new result lands, and cached in memory
 * between requests otherwise.
 */
import { prisma } from "@/lib/prisma";
import { allSportOrDefault } from "../sports";
import { bestMatch } from "../names";
import { normalizeName } from "@/lib/tennis/archive";
import { DEFAULT_ELO } from "@/lib/tennis/elo";
import { rateLeague, type LeagueRatings, type RatingPrior, type Result } from "./ratings";

const HISTORY_DAYS = 760; // this season and last, with room for a calendar-year league

/** Pure: maps names, drops duplicates (same pairing within a day). Exported for tests. */
export function mergeResults(feed: Result[], espn: Result[], feedNames: Iterable<string>): Result[] {
  const names = [...new Set(feedNames)];
  const map = new Map<string, string>();
  const canon = (n: string) => {
    if (!map.has(n)) map.set(n, names.includes(n) ? n : bestMatch(n, names) ?? n);
    return map.get(n)!;
  };
  const seen = new Set<string>();
  const out: Result[] = [];
  const key = (r: Result, offsetDays: number) => `${new Date(r.date.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10)}|${r.home}|${r.away}`;
  for (const r of feed) {
    seen.add(key(r, 0));
    out.push(r);
  }
  for (const raw of espn) {
    const r = { ...raw, home: canon(raw.home), away: canon(raw.away) };
    if (seen.has(key(r, 0)) || seen.has(key(r, -1)) || seen.has(key(r, 1))) continue;
    seen.add(key(r, 0));
    out.push(r);
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

const cache = new Map<string, { stamp: string; ratings: LeagueRatings }>();

/**
 * In one-on-one sports a player moves between tournaments, each its own league
 * in the feed, so ratings pool the whole sport; team sports rate per league.
 */
function poolsSport(sport: string): boolean {
  return allSportOrDefault(sport).family === "winner";
}

/** Tennis: every player the ATP/WTA archive knows starts from their career Elo. */
async function tennisPrior(): Promise<RatingPrior> {
  const rows = await prisma.tennisRating.findMany({ select: { norm: true, overall: true, nOverall: true } });
  const byNorm = new Map(rows.map((r) => [r.norm, r]));
  return (name) => {
    const r = byNorm.get(normalizeName(name));
    return r ? { rating: r.overall, games: r.nOverall } : null;
  };
}

export async function leagueRatings(leagueId: string, sport: string, now = new Date()): Promise<LeagueRatings> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const scope = poolsSport(sport) ? { league: { sport } } : { leagueId };
  const cacheKey = poolsSport(sport) ? `sport:${sport}` : leagueId;
  const finals = await prisma.sportEvent.findMany({
    where: { ...scope, status: "final", homeScore: { not: null }, awayScore: { not: null }, startsAt: { gte: since } },
    select: { id: true, startsAt: true, home: true, away: true, homeScore: true, awayScore: true, updatedAt: true },
    orderBy: { startsAt: "asc" },
  });
  const stamp = `${finals.length}|${finals.at(-1)?.updatedAt.getTime() ?? 0}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.stamp === stamp) return hit.ratings;

  const upcoming = await prisma.sportEvent.findMany({ where: { ...scope, NOT: { id: { startsWith: "espn:" } } }, select: { home: true, away: true }, take: 2000, orderBy: { startsAt: "desc" } });
  const toResult = (e: (typeof finals)[number]): Result => ({ date: e.startsAt, home: e.home, away: e.away, homeScore: e.homeScore!, awayScore: e.awayScore! });
  const merged = mergeResults(
    finals.filter((e) => !e.id.startsWith("espn:")).map(toResult),
    finals.filter((e) => e.id.startsWith("espn:")).map(toResult),
    upcoming.flatMap((e) => [e.home, e.away])
  );
  const ratings = rateLeague(allSportOrDefault(sport).family, sport, merged, sport === "tennis" ? { prior: await tennisPrior(), shrink: DEFAULT_ELO.calibrationShrink } : {});
  cache.set(cacheKey, { stamp, ratings });
  return ratings;
}

/** The two teams' last meetings in the league, newest first. */
export async function headToHead(leagueId: string, home: string, away: string, limit = 5) {
  const rows = await prisma.sportEvent.findMany({
    where: { leagueId, status: "final", OR: [{ home, away }, { home: away, away: home }] },
    orderBy: { startsAt: "desc" },
    take: limit,
    select: { startsAt: true, home: true, away: true, homeScore: true, awayScore: true },
  });
  return rows;
}
