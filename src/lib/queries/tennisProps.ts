/**
 * The tennis props board: the next day and a half of singles on the
 * all-sports boards, each player with his Elo, his archive match log and the
 * opponent's return record — and ARCHR's projection on games won, total games,
 * aces and double faults (lib/tennis/propModel.ts). Lines and chances are
 * priced in the browser from the projection.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/tennis/archive";
import { canonicalSurface, winProbFromRatings, type StoredRating } from "@/lib/tennis/elo";
import { surfaceForSportKey } from "@/lib/tennis/surface";
import { packTennisLog, toTennisLog, type PackedTennisLog, type TennisLog } from "@/lib/tennis/matchLog";
import { TENNIS_PROP_STATS, projectTennisProp, serveRecord, type TennisProjection, type TennisPropStat, type TourRates } from "@/lib/tennis/propModel";
import { cachedLogos, logoSrc } from "@/lib/allSports/logos";
import { espnTennisCity } from "@/lib/tennis/espnFixtures";
import { tennisSurfaceByCity } from "@/lib/tennis/espnResults";

const HOURS_AHEAD = 36;
const LOGS = 60;

export interface TennisPropsMatch {
  id: string;
  startsAt: string;
  tournament: string;
  surface: string | null;
  bestOf: 3 | 5;
  home: { name: string; logo: string };
  away: { name: string; logo: string };
}

export interface TennisPropsPlayer {
  id: string;
  name: string;
  photo: string;
  opponent: string;
  opponentPhoto: string;
  matchId: string;
  tour: string;
  elo: number | null;
  surfaceElo: number | null;
  opponentElo: number | null;
  /** His Elo win chance, calibrated. */
  winProb: number;
  rated: boolean;
  matches: number;
  projections: Partial<Record<TennisPropStat, TennisProjection>>;
}

export interface TennisPropsSlate {
  season: number;
  matches: TennisPropsMatch[];
  players: Record<string, TennisPropsPlayer>;
  logs: Record<string, PackedTennisLog[]>;
}

const tourRates = cache(async (): Promise<Record<string, TourRates>> => {
  const rows = await prisma.$queryRaw<{ tour: string; sg: number; aces: number; dfs: number }[]>`
    SELECT tour, sum(coalesce("winnerSvGms",0) + coalesce("loserSvGms",0))::float AS sg,
      sum(coalesce("winnerAces",0) + coalesce("loserAces",0))::float AS aces, sum(coalesce("winnerDfs",0) + coalesce("loserDfs",0))::float AS dfs
    FROM "TennisArchiveMatch" WHERE "tourneyDate" > now() - interval '3 years' AND "winnerSvGms" IS NOT NULL GROUP BY tour`;
  const out: Record<string, TourRates> = { atp: { aces: 0.55, doubleFaults: 0.27 }, wta: { aces: 0.27, doubleFaults: 0.37 } };
  for (const r of rows) if (r.sg > 0) out[r.tour] = { aces: r.aces / r.sg, doubleFaults: r.dfs / r.sg };
  return out;
});

const SLAM = /australian open|roland garros|french open|wimbledon|us open/i;

export const getTennisPropsSlate = cache(async (now: Date = new Date()): Promise<TennisPropsSlate> => {
  const season = now.getUTCFullYear();
  const events = await prisma.sportEvent.findMany({
    where: { league: { sport: "tennis" }, status: "scheduled", startsAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lte: new Date(now.getTime() + HOURS_AHEAD * 3_600_000) }, NOT: [{ home: { contains: "/" } }, { away: "" }] },
    orderBy: { startsAt: "asc" },
    take: 80,
    include: { league: { select: { name: true, providerKey: true } } },
  });
  // The same match listed twice (feed and ESPN): keep the first.
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const k = [normalizeName(e.home), normalizeName(e.away)].sort().join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const names = [...new Set(unique.flatMap((e) => [e.home, e.away]))];
  const norms = names.map(normalizeName);
  const [ratings, logos, rates, byCity] = await Promise.all([
    prisma.tennisRating.findMany({ where: { norm: { in: norms } }, orderBy: { nOverall: "desc" } }),
    cachedLogos("tennis", names),
    tourRates(),
    unique.some((e) => espnTennisCity(e.league.providerKey)) ? tennisSurfaceByCity() : new Map<string, string>(),
  ]);
  const ratingOf = new Map<string, (typeof ratings)[number]>();
  for (const r of ratings) if (!ratingOf.has(r.norm)) ratingOf.set(r.norm, r);
  const ids = [...new Set([...ratingOf.values()].map((r) => r.sackId))];
  const rows = ids.length
    ? await prisma.tennisArchiveMatch.findMany({
        where: { OR: [{ winnerSackId: { in: ids } }, { loserSackId: { in: ids } }], tourneyDate: { gte: new Date(now.getTime() - 3 * 365 * 86_400_000) } },
        orderBy: [{ tourneyDate: "desc" }, { matchNum: "desc" }],
      })
    : [];
  const logsBy = new Map<string, TennisLog[]>();
  // What his opponents did on serve against him: his return record.
  const returnBy = new Map<string, { returnGames: number; acesAgainst: number; doubleFaultsAgainst: number; n: number }>();
  for (const r of rows) {
    for (const id of [r.winnerSackId, r.loserSackId]) {
      if (!ids.includes(id)) continue;
      const list = logsBy.get(id) ?? logsBy.set(id, []).get(id)!;
      if (list.length < LOGS) {
        const l = toTennisLog(r, id);
        if (l) list.push(l);
      }
      const ret = returnBy.get(id) ?? { returnGames: 0, acesAgainst: 0, doubleFaultsAgainst: 0, n: 0 };
      const opp = id === r.winnerSackId ? "loser" : "winner";
      const sg = opp === "loser" ? r.loserSvGms : r.winnerSvGms;
      const ac = opp === "loser" ? r.loserAces : r.winnerAces;
      const df = opp === "loser" ? r.loserDfs : r.winnerDfs;
      if (sg && ac !== null && df !== null && ret.n < 40) {
        ret.returnGames += sg;
        ret.acesAgainst += ac;
        ret.doubleFaultsAgainst += df;
        ret.n++;
      }
      returnBy.set(id, ret);
    }
  }

  const matches: TennisPropsMatch[] = [];
  const players: Record<string, TennisPropsPlayer> = {};
  const logs: Record<string, PackedTennisLog[]> = {};
  for (const e of unique) {
    const city = espnTennisCity(e.league.providerKey);
    const surface = (city ? byCity.get(city) : undefined) ?? surfaceForSportKey(e.league.providerKey) ?? surfaceForSportKey(e.league.name.toLowerCase().replace(/[^a-z]+/g, "_"));
    const bestOf: 3 | 5 = SLAM.test(e.league.name) && !/wta|women/i.test(e.league.name + e.league.providerKey) ? 5 : 3;
    matches.push({ id: e.id, startsAt: e.startsAt.toISOString(), tournament: e.league.name, surface, bestOf, home: { name: e.home, logo: logoSrc("tennis", e.home, logos) }, away: { name: e.away, logo: logoSrc("tennis", e.away, logos) } });
    const surf = canonicalSurface(surface);
    for (const [me, them] of [
      [e.home, e.away],
      [e.away, e.home],
    ] as const) {
      const r = ratingOf.get(normalizeName(me));
      const o = ratingOf.get(normalizeName(them));
      const stored = (x: typeof r): StoredRating | null => (x ? { overall: x.overall, hard: x.hard, clay: x.clay, grass: x.grass, carpet: x.carpet } as StoredRating : null);
      const sr = stored(r);
      const so = stored(o);
      const rated = !!(r && o && r.nOverall >= 10 && o.nOverall >= 10);
      const p = sr && so ? winProbFromRatings(sr, so, surf) : 0.5;
      const myLogs = r ? (logsBy.get(r.sackId) ?? []) : [];
      const mine = serveRecord(myLogs);
      const ret = o ? (returnBy.get(o.sackId) ?? { returnGames: 0, acesAgainst: 0, doubleFaultsAgainst: 0 }) : { returnGames: 0, acesAgainst: 0, doubleFaultsAgainst: 0 };
      const tour = rates[r?.tour ?? o?.tour ?? "atp"] ?? rates.atp!;
      const projections: Partial<Record<TennisPropStat, TennisProjection>> = {};
      for (const stat of TENNIS_PROP_STATS) {
        if ((stat.key === "aces" || stat.key === "doubleFaults") && mine.matches < 3) continue;
        projections[stat.key] = projectTennisProp(stat.key, { p, bestOf, mine, theirsReturn: ret, tour });
      }
      const id = `${e.id}:${normalizeName(me)}`;
      players[id] = {
        id,
        name: me,
        photo: logoSrc("tennis", me, logos),
        opponent: them,
        opponentPhoto: logoSrc("tennis", them, logos),
        matchId: e.id,
        tour: r?.tour ?? o?.tour ?? "atp",
        elo: r?.overall ?? null,
        surfaceElo: r && surf ? ((r as unknown as Record<string, number | null>)[surf] ?? null) : null,
        opponentElo: o?.overall ?? null,
        winProb: p,
        rated,
        matches: r?.nOverall ?? 0,
        projections,
      };
      logs[id] = myLogs.map(packTennisLog);
    }
  }
  return { season, matches, players, logs };
});
