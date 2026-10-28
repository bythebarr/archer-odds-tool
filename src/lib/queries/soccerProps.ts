/**
 * The soccer player props board for one league: its next matches, every player
 * with a role in them (from his team's last six matches, or the confirmed XI
 * once ESPN posts it), his recent match logs, and ARCHR's projection for each
 * prop he'd be offered. Lines and chances are worked out in the browser from
 * the projection (propModel.ts), so the sheet can move along the ladder.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { seasonOf } from "@/lib/allSports/model/ratings";
import { cachedLogos, logoSrc } from "@/lib/allSports/logos";
import {
  MIN_EXPECTED_MINUTES,
  MINUTES_WINDOW,
  SOCCER_PROP_STATS,
  packSoccerLog,
  projectSoccerProp,
  type PackedSoccerLog,
  type Position,
  type SoccerLog,
  type SoccerProjection,
  type SoccerPropStat,
} from "@/lib/soccer/propModel";
import type { EspnSoccerSummary } from "@/lib/soccer/playerStats";
import { shotContext, teamShotTotals } from "@/lib/soccer/shotContext";

const DAYS_AHEAD = 5;
const MAX_MATCHES = 12;
const LOG_DAYS = 420;
const MAX_LOGS = 40;
/** Logs sent with the board (the cards' last-10 strip); the sheet loads the rest. */
const CARD_LOGS = 10;
/** Confirmed line-ups are looked for this long before kickoff. */
const LINEUP_WINDOW_MS = 100 * 60_000;

export interface SoccerPropsLeague {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  logoUrl: string | null;
  matches: number;
}

export interface SoccerPropsMatch {
  id: string;
  startsAt: string;
  home: { name: string; logo: string };
  away: { name: string; logo: string };
  /** ESPN has posted both starting XIs. */
  lineups: boolean;
}

export interface SoccerPropsPlayer {
  id: string;
  name: string;
  position: Position;
  headshotUrl: string | null;
  team: string;
  teamLogo: string;
  opponent: string;
  opponentLogo: string;
  venue: "home" | "away";
  matchId: string;
  /** "starting" / "bench" once the line-ups are out; null before. */
  lineup: "starting" | "bench" | null;
  projections: Partial<Record<SoccerPropStat, SoccerProjection>>;
}

export interface SoccerPropsSlate {
  season: number;
  leagues: SoccerPropsLeague[];
  league: SoccerPropsLeague | null;
  matches: SoccerPropsMatch[];
  players: Record<string, SoccerPropsPlayer>;
  /** Each player's last ten matches; the full log comes from soccerPlayerLogs. */
  logs: Record<string, PackedSoccerLog[]>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Leagues with ESPN fixtures in the next few days, the big ones first. */
async function propLeagues(now: Date): Promise<SoccerPropsLeague[]> {
  const rows = await prisma.sportEvent.groupBy({
    by: ["leagueId"],
    where: { id: { startsWith: "espn:" }, status: "scheduled", startsAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lte: new Date(now.getTime() + DAYS_AHEAD * 86_400_000) }, league: { sport: "soccer", active: true } },
    _count: { _all: true },
  });
  const leagues = await prisma.league.findMany({ where: { id: { in: rows.map((r) => r.leagueId) } }, orderBy: [{ rank: "asc" }, { name: "asc" }] });
  const count = new Map(rows.map((r) => [r.leagueId, r._count._all]));
  return leagues.map((l) => ({ id: l.id, slug: l.id.slice("soccer/".length), name: l.name, region: l.region, logoUrl: l.logoUrl, matches: count.get(l.id) ?? 0 }));
}

/** Both XIs from ESPN, once posted: athlete id → starting or bench. */
async function confirmedLineup(espnPath: string, eventId: string): Promise<Map<string, "starting" | "bench"> | null> {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${eventId.slice(5)}`, { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const body = (await res.json()) as EspnSoccerSummary;
    const out = new Map<string, "starting" | "bench">();
    let starters = 0;
    for (const side of body.rosters ?? []) {
      for (const e of side.roster ?? []) {
        if (!e.athlete?.id) continue;
        out.set(e.athlete.id, e.starter ? "starting" : "bench");
        if (e.starter) starters++;
      }
    }
    return starters >= 20 ? out : null;
  } catch {
    return null;
  }
}

/** League average shots and shots on target per team per match (last year, every league). */
const leagueShotRates = cache(async (): Promise<{ shots: number; sot: number }> => {
  const [row] = await prisma.$queryRaw<{ shots: number | null; sot: number | null }[]>`
    SELECT avg(s)::float AS shots, avg(o)::float AS sot FROM (
      SELECT sum("shots") AS s, sum("shotsOnTarget") AS o FROM "SoccerPlayerMatch"
      WHERE "date" > now() - interval '365 days' GROUP BY "team", "eventId"
    ) t`;
  return { shots: row?.shots ?? 12, sot: row?.sot ?? 4 };
});

export const getSoccerPropsSlate = cache(async (leagueSlug: string | null, now: Date = new Date()): Promise<SoccerPropsSlate> => {
  const season = seasonOf(now);
  const leagues = await propLeagues(now);
  const empty: SoccerPropsSlate = { season, leagues, league: null, matches: [], players: {}, logs: {} };
  const candidatesLeagues = leagueSlug ? leagues.filter((l) => l.slug === leagueSlug) : leagues;
  if (!candidatesLeagues.length) return empty;

  for (const league of candidatesLeagues.slice(0, leagueSlug ? 1 : 6)) {
    const slate = await leagueSlate(league, leagues, season, now);
    if (slate.matches.length && Object.keys(slate.players).length) return slate;
    if (leagueSlug) return slate;
  }
  return { ...empty, league: candidatesLeagues[0]! };
});

async function leagueSlate(league: SoccerPropsLeague, leagues: SoccerPropsLeague[], season: number, now: Date): Promise<SoccerPropsSlate> {
  const meta = await prisma.league.findUnique({ where: { id: league.id }, select: { espnPath: true } });
  const events = await prisma.sportEvent.findMany({
    where: { leagueId: league.id, id: { startsWith: "espn:" }, status: "scheduled", startsAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lte: new Date(now.getTime() + DAYS_AHEAD * 86_400_000) } },
    orderBy: { startsAt: "asc" },
    take: MAX_MATCHES,
  });
  const teams = [...new Set(events.flatMap((e) => [e.home, e.away]))];
  const since = new Date(now.getTime() - LOG_DAYS * 86_400_000);

  // Each team's last matches, newest first, and who played in them.
  const teamRows = await prisma.soccerPlayerMatch.findMany({
    where: { team: { in: teams }, date: { gte: new Date(now.getTime() - 150 * 86_400_000), lt: now } },
    select: { team: true, date: true, playerId: true },
    orderBy: { date: "desc" },
  });
  const teamDates = new Map<string, string[]>();
  for (const r of teamRows) {
    const list = teamDates.get(r.team) ?? teamDates.set(r.team, []).get(r.team)!;
    if (list[list.length - 1] !== day(r.date)) list.push(day(r.date));
  }
  const roster = new Map<string, Set<string>>();
  for (const r of teamRows) {
    if (!(teamDates.get(r.team) ?? []).slice(0, MINUTES_WINDOW).includes(day(r.date))) continue;
    (roster.get(r.team) ?? roster.set(r.team, new Set()).get(r.team)!).add(r.playerId);
  }
  const playerIds = [...new Set([...roster.values()].flatMap((s) => [...s]))];

  const [players, logRows, shotRows, rates, logos] = await Promise.all([
    prisma.soccerPlayer.findMany({ where: { id: { in: playerIds } } }),
    prisma.soccerPlayerMatch.findMany({ where: { playerId: { in: playerIds }, date: { gte: since, lt: now } }, orderBy: { date: "desc" } }),
    prisma.$queryRaw<{ team: string; opponent: string; date: Date; isHome: boolean; shots: number; sot: number }[]>`
      SELECT "team", "opponent", "date", bool_or("isHome") AS "isHome", sum("shots")::int AS shots, sum("shotsOnTarget")::int AS sot
      FROM "SoccerPlayerMatch"
      WHERE ("team" = ANY(${teams}::text[]) OR "opponent" = ANY(${teams}::text[])) AND "date" > now() - interval '200 days'
      GROUP BY "team", "opponent", "date"`,
    leagueShotRates(),
    cachedLogos("soccer", teams),
  ]);
  const shots = teamShotTotals(shotRows.map((r) => ({ team: r.team, opponent: r.opponent, date: day(r.date), isHome: r.isHome, shots: r.shots, shotsOnTarget: r.sot })));
  shots.leagueShots = rates.shots;
  shots.leagueSot = rates.sot;

  const logsBy = new Map<string, SoccerLog[]>();
  for (const r of logRows) {
    const list = logsBy.get(r.playerId) ?? logsBy.set(r.playerId, []).get(r.playerId)!;
    if (list.length >= MAX_LOGS) continue;
    list.push({ date: day(r.date), opponent: r.opponent, isHome: r.isHome, season: seasonOf(r.date), team: r.team, starter: r.starter, minutes: r.minutes, goals: r.goals, assists: r.assists, shots: r.shots, shotsOnTarget: r.shotsOnTarget, saves: r.saves, yellowCards: r.yellowCards, redCards: r.redCards, fouls: r.fouls });
  }
  const playerBy = new Map(players.map((p) => [p.id, p]));

  const matches: SoccerPropsMatch[] = [];
  const out: Record<string, SoccerPropsPlayer> = {};
  const logs: Record<string, PackedSoccerLog[]> = {};
  const today = day(now);
  for (const ev of events) {
    const lineup = meta?.espnPath && ev.startsAt.getTime() - now.getTime() < LINEUP_WINDOW_MS ? await confirmedLineup(meta.espnPath, ev.id) : null;
    matches.push({ id: ev.id, startsAt: ev.startsAt.toISOString(), home: { name: ev.home, logo: logoSrc("soccer", ev.home, logos) }, away: { name: ev.away, logo: logoSrc("soccer", ev.away, logos) }, lineups: !!lineup });
    for (const venue of ["home", "away"] as const) {
      const team = venue === "home" ? ev.home : ev.away;
      const opponent = venue === "home" ? ev.away : ev.home;
      const dates = teamDates.get(team) ?? [];
      if (dates.length < 2) continue;
      const ctx = shotContext(shots, opponent, today, venue === "home");
      for (const pid of roster.get(team) ?? []) {
        const p = playerBy.get(pid);
        const pl = logsBy.get(pid) ?? [];
        if (!p || out[pid]) continue;
        const role = lineup?.get(pid) ?? null;
        if (lineup && !role) continue; // not in tonight's squad
        const position = (p.position as Position | null) ?? "M";
        const projections: Partial<Record<SoccerPropStat, SoccerProjection>> = {};
        for (const stat of SOCCER_PROP_STATS) {
          if (!stat.positions.includes(position)) continue;
          let proj = projectSoccerProp(pl, dates, stat, position, ctx);
          if (role) {
            const starts = pl.filter((l) => l.starter).slice(0, 10);
            const subs = pl.filter((l) => !l.starter).slice(0, 10);
            const avg = (xs: SoccerLog[], dflt: number) => (xs.length ? xs.reduce((a, l) => a + l.minutes, 0) / xs.length : dflt);
            const minutes = role === "starting" ? avg(starts, 80) : avg(subs, 20);
            proj = { ...proj, mean: (proj.mean / Math.max(1, proj.minutes)) * minutes, minutes, playProb: role === "starting" ? 0.99 : 0.5, expected: minutes };
          } else if (proj.expected < MIN_EXPECTED_MINUTES) continue;
          projections[stat.key] = proj;
        }
        if (!Object.keys(projections).length) continue;
        out[pid] = {
          id: pid,
          name: p.name,
          position,
          headshotUrl: p.headshotUrl ?? p.photoUrl,
          team,
          teamLogo: logoSrc("soccer", team, logos),
          opponent,
          opponentLogo: logoSrc("soccer", opponent, logos),
          venue,
          matchId: ev.id,
          lineup: role,
          projections,
        };
        logs[pid] = pl.slice(0, CARD_LOGS).map(packSoccerLog);
      }
    }
  }
  return { season, leagues, league, matches, players: out, logs };
}

/** For the event page: does this match have a props board? */
export async function soccerPropsLink(eventId: string): Promise<string | null> {
  const ev = await prisma.sportEvent.findUnique({ where: { id: eventId }, select: { leagueId: true, status: true, league: { select: { sport: true } } } });
  if (!ev || ev.league.sport !== "soccer" || ev.status !== "scheduled" || !eventId.startsWith("espn:")) return null;
  return `/sports/soccer/props?league=${encodeURIComponent(ev.leagueId.slice("soccer/".length))}&match=${encodeURIComponent(eventId)}`;
}

/** One player's last 40 matches, for the sheet's chart and splits. */
export async function soccerPlayerLogs(playerId: string, now = new Date()): Promise<PackedSoccerLog[]> {
  const rows = await prisma.soccerPlayerMatch.findMany({
    where: { playerId, date: { gte: new Date(now.getTime() - LOG_DAYS * 86_400_000), lt: now } },
    orderBy: { date: "desc" },
    take: MAX_LOGS,
  });
  return rows.map((r) =>
    packSoccerLog({ date: day(r.date), opponent: r.opponent, isHome: r.isHome, season: seasonOf(r.date), team: r.team, starter: r.starter, minutes: r.minutes, goals: r.goals, assists: r.assists, shots: r.shots, shotsOnTarget: r.shotsOnTarget, saves: r.saves, yellowCards: r.yellowCards, redCards: r.redCards, fouls: r.fouls })
  );
}
