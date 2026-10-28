/**
 * The MLB props board: the day's games (today, else the next day with games),
 * every batter in each lineup — the posted one, else everyone who's been
 * playing — and both probable starters, with ARCHR's projection for each prop
 * (src/lib/mlb/propProjection.ts) as a full distribution, and every book's line
 * where books have posted. Lines and chances are priced in the browser from the
 * distribution, so the sheet can move along the ladder.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc, etDateOf, shiftEtDate, todayEt } from "@/lib/dateEt";
import { mlbHeadshotUrl, mlbTeamLogoUrl } from "@/lib/logos";
import { projectMlbProp, type MlbProjection, type MlbPropStat } from "@/lib/mlb/propProjection";
import { MLB_PROP_STATS, packMlbLog, type MlbChartLog, type MlbRole, type PackedMlbLog } from "@/lib/mlb/propsSlate";
import type { PropQuote } from "@/lib/nba/propsMath";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import type { StatDistribution } from "@/lib/propModel/distribution";

/** Batters with at least this many of the team's last ten games are listed when no lineup is posted. */
const REGULAR_GAMES = 4;
const LOG_LIMIT = 200;

export interface MlbPropsTeam {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

export interface MlbPropsGame {
  id: string;
  startUtc: string;
  status: string;
  home: MlbPropsTeam;
  away: MlbPropsTeam;
  lineups: boolean;
}

export interface MlbPropsPlayer {
  id: string;
  name: string;
  headshotUrl: string;
  role: MlbRole;
  /** Batting-order spot once the lineup's posted. */
  battingOrder: number | null;
  team: MlbPropsTeam;
  opponent: MlbPropsTeam;
  venue: "home" | "away";
  gameId: string;
  /** The opposing starter's hand (a batter's platoon split). */
  opposingHand: "L" | "R" | null;
  opposingStarter: string | null;
}

export interface MlbSlateProjection extends Omit<MlbProjection, "distribution" | "seasons"> {
  distribution: StatDistribution;
}

export interface MlbSlateProp {
  playerId: string;
  stat: MlbPropStat;
  quotes: PropQuote[];
  projection: MlbSlateProjection;
}

export interface MlbPropsSlate {
  date: string;
  season: number;
  games: MlbPropsGame[];
  players: Record<string, MlbPropsPlayer>;
  props: MlbSlateProp[];
  logs: Record<string, PackedMlbLog[]>;
}

const hand = (h: string | null | undefined): "L" | "R" | null => (h === "L" || h === "R" ? h : null);

function team(t: { id: string; name: string; abbreviation: string; mlbTeamId: number | null }): MlbPropsTeam {
  return { id: t.id, name: t.name, abbreviation: t.abbreviation, logoUrl: t.mlbTeamId ? mlbTeamLogoUrl(t.mlbTeamId) : null };
}

/** A projection made JSON-small: the distribution trimmed of its negligible tail. */
function slim(p: MlbProjection): MlbSlateProjection {
  const { seasons: _seasons, distribution, ...rest } = p;
  void _seasons;
  if (distribution.kind !== "pmf") return { ...rest, distribution };
  let end = distribution.pmf.length;
  while (end > 1 && distribution.pmf[end - 1]! < 1e-6) end--;
  return { ...rest, distribution: { kind: "pmf", pmf: distribution.pmf.slice(0, end).map((x) => Math.round(x * 1e6) / 1e6) } };
}

async function slateDate(now: Date): Promise<string> {
  const today = todayEt();
  const { gte } = etDayBoundsUtc(today);
  const next = await prisma.game.findFirst({
    where: { sport: "mlb", status: { not: "final" }, scheduledStartUtc: { gte } },
    orderBy: { scheduledStartUtc: "asc" },
    select: { scheduledStartUtc: true },
  });
  void now;
  return next ? etDateOf(next.scheduledStartUtc) : today;
}

export const getMlbPropsSlate = cache(async (dateParam: string | null = null, now: Date = new Date()): Promise<MlbPropsSlate> => {
  const date = dateParam ?? (await slateDate(now));
  const season = Number(date.slice(0, 4));
  const { gte, lt } = etDayBoundsUtc(date);
  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      homeProbablePitcher: true,
      awayProbablePitcher: true,
      lineupSlots: true,
    },
  });
  const empty: MlbPropsSlate = { date, season, games: [], players: {}, props: [], logs: {} };
  if (!games.length) return empty;

  // Who plays: the posted lineup, else every batter with a regular role over the team's last ten games.
  const teamIds = [...new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((x): x is string => !!x))];
  const recent = await prisma.playerGameLog.findMany({
    where: { teamId: { in: teamIds }, gameDate: { lt: gte, gte: new Date(gte.getTime() - 40 * 86_400_000) }, plateAppearances: { gt: 0 } },
    select: { mlbPlayerId: true, teamId: true, gameId: true, gameDate: true },
    orderBy: { gameDate: "desc" },
  });
  const teamGames = new Map<string, string[]>();
  for (const r of recent) {
    const list = teamGames.get(r.teamId) ?? teamGames.set(r.teamId, []).get(r.teamId)!;
    if (!list.includes(r.gameId) && list.length < 10) list.push(r.gameId);
  }
  const regulars = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const r of recent) {
    if (!teamGames.get(r.teamId)?.includes(r.gameId)) continue;
    const k = `${r.teamId}|${r.mlbPlayerId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (counts.get(k) === REGULAR_GAMES) (regulars.get(r.teamId) ?? regulars.set(r.teamId, new Set()).get(r.teamId)!).add(r.mlbPlayerId);
  }

  const lineupPersonIds = games.flatMap((g) => g.lineupSlots.map((s) => s.mlbPersonId));
  const starterPersonIds = games.flatMap((g) => [g.homeProbablePitcher?.mlbPersonId, g.awayProbablePitcher?.mlbPersonId]).filter((x): x is number => !!x);
  const byPerson = await prisma.mlbPlayer.findMany({ where: { mlbPersonId: { in: [...lineupPersonIds, ...starterPersonIds] } } });
  const personToPlayer = new Map(byPerson.map((p) => [p.mlbPersonId, p]));

  interface Entry { playerId: string; role: MlbRole; battingOrder: number | null; game: (typeof games)[number]; venue: "home" | "away" }
  const entries: Entry[] = [];
  for (const g of games) {
    if (!g.homeTeamId || !g.awayTeamId) continue;
    for (const venue of ["home", "away"] as const) {
      const teamId = venue === "home" ? g.homeTeamId : g.awayTeamId;
      const slots = g.lineupSlots.filter((s) => s.teamId === teamId);
      if (slots.length >= 9) {
        for (const s of slots) {
          const p = personToPlayer.get(s.mlbPersonId);
          if (p) entries.push({ playerId: p.id, role: "batter", battingOrder: s.battingOrder, game: g, venue });
        }
      } else {
        for (const id of regulars.get(teamId) ?? []) entries.push({ playerId: id, role: "batter", battingOrder: null, game: g, venue });
      }
      const sp = venue === "home" ? g.homeProbablePitcher : g.awayProbablePitcher;
      const spPlayer = sp ? personToPlayer.get(sp.mlbPersonId) : undefined;
      if (spPlayer) entries.push({ playerId: spPlayer.id, role: "pitcher", battingOrder: null, game: g, venue });
    }
  }
  if (!entries.length) return { ...empty, games: games.filter((g) => g.homeTeam && g.awayTeam).map((g) => gameView(g, false)) };

  const playerIds = [...new Set(entries.map((e) => e.playerId))];
  const [players, logRows, quotes] = await Promise.all([
    prisma.mlbPlayer.findMany({ where: { id: { in: playerIds } } }),
    prisma.playerGameLog.findMany({
      where: { mlbPlayerId: { in: playerIds }, gameDate: { lt: gte } },
      orderBy: { gameDate: "desc" },
      include: { game: { select: { homeTeamId: true, awayTeamId: true, homeTeam: { select: { abbreviation: true } }, awayTeam: { select: { abbreviation: true } } } } },
    }),
    prisma.currentPlayerPropLine.findMany({ where: { gameId: { in: games.map((g) => g.id) }, mlbPlayerId: { in: playerIds } } }),
  ]);
  const playerBy = new Map(players.map((p) => [p.id, p]));
  const logsBy = new Map<string, MlbChartLog[]>();
  for (const r of logRows) {
    const list = logsBy.get(r.mlbPlayerId) ?? logsBy.set(r.mlbPlayerId, []).get(r.mlbPlayerId)!;
    if (list.length >= LOG_LIMIT) continue;
    const opponent = (r.teamId === r.game.homeTeamId ? r.game.awayTeam?.abbreviation : r.game.homeTeam?.abbreviation) ?? "";
    list.push({
      date: etDateOf(r.gameDate),
      season: r.gameDate.getUTCFullYear(),
      isHome: r.isHome,
      opponent,
      opposingStarterHand: hand(r.opposingStarterHand),
      plateAppearances: r.plateAppearances,
      hits: r.hits,
      totalBases: r.totalBases,
      homeRuns: r.homeRuns,
      rbi: r.rbi,
      runs: r.runs,
      baseOnBalls: r.baseOnBalls,
      strikeoutsBatting: r.strikeoutsBatting,
      stolenBases: r.stolenBases,
      isStarter: r.isStarter,
      outsRecorded: r.outsRecorded,
      strikeoutsPitching: r.strikeoutsPitching,
      earnedRuns: r.earnedRuns,
      hitsAllowed: r.hitsAllowed,
      walksAllowed: r.walksAllowed,
    });
  }

  // Matchup inputs: each starter's strikeouts per batter faced, each lineup's strikeouts per PA (last 30 days).
  const starterKRate = (playerId: string | undefined) => {
    const starts = (playerId ? logsBy.get(playerId) ?? [] : []).filter((l) => l.isStarter).slice(0, 15);
    const bf = starts.reduce((a, l) => a + (l.outsRecorded ?? 0) + (l.hitsAllowed ?? 0) + (l.walksAllowed ?? 0), 0);
    return bf >= 60 ? starts.reduce((a, l) => a + (l.strikeoutsPitching ?? 0), 0) / bf : null;
  };
  const lineupK = await prisma.playerGameLog.groupBy({
    by: ["teamId"],
    where: { teamId: { in: teamIds }, gameDate: { lt: gte, gte: new Date(gte.getTime() - 30 * 86_400_000) } },
    _sum: { strikeoutsBatting: true, plateAppearances: true },
  });
  const teamKRate = new Map(lineupK.map((t) => [t.teamId, (t._sum.plateAppearances ?? 0) >= 200 ? (t._sum.strikeoutsBatting ?? 0) / t._sum.plateAppearances! : null]));

  const outPlayers: Record<string, MlbPropsPlayer> = {};
  const outProps: MlbSlateProp[] = [];
  const outLogs: Record<string, PackedMlbLog[]> = {};
  for (const e of entries) {
    const p = playerBy.get(e.playerId);
    const g = e.game;
    if (!p || !g.homeTeam || !g.awayTeam || outPlayers[e.playerId]) continue;
    const mine = e.venue === "home" ? g.homeTeam : g.awayTeam;
    const theirs = e.venue === "home" ? g.awayTeam : g.homeTeam;
    const oppStarter = e.venue === "home" ? g.awayProbablePitcher : g.homeProbablePitcher;
    const logs = logsBy.get(e.playerId) ?? [];
    const ctx = {
      season,
      opposingHand: hand(oppStarter?.pitchHand),
      starterKRate: e.role === "batter" ? starterKRate(oppStarter ? personToPlayer.get(oppStarter.mlbPersonId)?.id : undefined) : null,
      opponentKRate: e.role === "pitcher" ? (teamKRate.get(theirs.id) ?? null) : null,
    };
    let any = false;
    for (const stat of MLB_PROP_STATS) {
      if (stat.role !== e.role) continue;
      const proj = projectMlbProp(logs, stat.key, ctx);
      if (!proj) continue;
      any = true;
      const q = stat.category
        ? quotes
            .filter((x) => x.mlbPlayerId === e.playerId && x.gameId === g.id && x.statCategory === stat.category)
            .map((x): PropQuote => ({ bookKey: x.bookKey, bookName: BOOK_NAMES[x.bookKey] ?? x.bookKey, side: x.side === "over" ? "over" : "under", point: x.point, priceAmerican: x.priceAmerican }))
        : [];
      outProps.push({ playerId: e.playerId, stat: stat.key, quotes: q, projection: slim(proj) });
    }
    if (!any) continue;
    outPlayers[e.playerId] = {
      id: e.playerId,
      name: p.fullName,
      headshotUrl: mlbHeadshotUrl(p.mlbPersonId),
      role: e.role,
      battingOrder: e.battingOrder,
      team: team(mine),
      opponent: team(theirs),
      venue: e.venue,
      gameId: g.id,
      opposingHand: ctx.opposingHand,
      opposingStarter: oppStarter?.fullName ?? null,
    };
    outLogs[e.playerId] = logs.map(packMlbLog);
  }

  return {
    date,
    season,
    games: games.filter((g) => g.homeTeam && g.awayTeam).map((g) => gameView(g, g.lineupSlots.length >= 18)),
    players: outPlayers,
    props: outProps,
    logs: outLogs,
  };
});

function gameView(g: { id: string; scheduledStartUtc: Date; status: string; homeTeam: Parameters<typeof team>[0] | null; awayTeam: Parameters<typeof team>[0] | null }, lineups: boolean): MlbPropsGame {
  return { id: g.id, startUtc: g.scheduledStartUtc.toISOString(), status: g.status, home: team(g.homeTeam!), away: team(g.awayTeam!), lineups };
}

/** The next few days with MLB games, for the date chips. */
export async function mlbPropDates(from = todayEt()): Promise<string[]> {
  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte: etDayBoundsUtc(shiftEtDate(from, -1)).gte, lt: etDayBoundsUtc(shiftEtDate(from, 4)).lt } },
    select: { scheduledStartUtc: true },
  });
  return [...new Set(games.map((g) => etDateOf(g.scheduledStartUtc)))].sort();
}
