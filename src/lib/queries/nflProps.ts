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
import { NFL_PROP_STAT_BY_KEY, nflPositionGroup, type NflStatLine } from "@/lib/nfl/propStats";
import type { NflDefenseTable, NflPosition } from "@/lib/nfl/matchup";
import { NFL_EXTRA_COLUMNS, NFL_LOG_COLUMNS as COLUMNS, emptyNflExtras, packNflLog, summarizeNflProp, unpackNflLog, type NflLogPoint, type NflSlateProp, type PackedNflLog } from "@/lib/nfl/propsMath";
import { EV_FLAG } from "@/lib/odds/marketValue";
import { injuryLevel, type PlayerInjuryInfo } from "@/lib/injuries/status";
import type { Absence } from "@/lib/injuries/absence";
import type { SlateGame, SlateTeam } from "./nbaProps";
import type { GameLines } from "@/lib/propModel/environment";
import { nflProjectionContext } from "@/lib/nfl/slateContext";
import { projectNflProp } from "@/lib/nfl/projection";
import { projectedLine } from "@/lib/nba/propsMath";
import type { NflPropStat } from "@/generated/prisma/client";
import { getConsensusGameLines } from "./gameLines";
import { getModelWeights } from "./modelWeights";

export interface NflSlatePlayer {
  id: string;
  name: string;
  headshotUrl: string;
  position: NflPosition | null;
  gameId: string;
  team: SlateTeam | null;
  opponent: SlateTeam | null;
  venue: "home" | "away" | null;
  injury: PlayerInjuryInfo | null;
}

export interface NflPropsSlate {
  season: number;
  games: SlateGame[];
  players: Record<string, NflSlatePlayer>;
  logs: Record<string, PackedNflLog[]>;
  /** Aligned with `logs`: the team's targets, rush attempts and pass attempts in each of those games. */
  usage: Record<string, [number, number, number][]>;
  props: NflSlateProp[];
  defense: NflDefenseTable;
  /** Per team abbreviation: key players ruled out or doubtful this week. */
  absences: Record<string, Absence[]>;
  /** Game id → this week's consensus spread and total (the projection's game environment). */
  lines: Record<string, GameLines>;
  /** Team abbreviation → points per game over its recent games, the baseline for implied points. */
  teamPoints: Record<string, number>;
  /** Stat → the model's fitted weight against the market (stats without a fit use the default). */
  modelWeights: Record<string, number>;
  lastPolledAt: string | null;
}

/** The props ARCHR posts its own line on, by position, before the books do. */
const NFL_PROJECTED_STATS: Partial<Record<NflPosition, NflPropStat[]>> = {
  QB: ["passYards", "passTds", "passCompletions", "passAttempts", "rushYards"],
  RB: ["rushYards", "rushAttempts", "receptions", "recYards", "rushRecYards", "anytimeTd"],
  WR: ["recYards", "receptions", "anytimeTd"],
  TE: ["recYards", "receptions", "anytimeTd"],
};

/**
 * A skill player's position from what he does, for players whose roster
 * position isn't on file: throws → QB, mostly carries → RB, catches → WR (a
 * tight end reads as WR, which only shifts which defense-by-position row he's
 * matched to). Null for someone with no offensive touches.
 */
export function inferNflPosition(logs: { passAttempts: number; rushAttempts: number; receptions: number; targets: number }[]): string | null {
  const sum = (f: (l: (typeof logs)[number]) => number) => logs.reduce((a, l) => a + f(l), 0);
  const pass = sum((l) => l.passAttempts);
  const rush = sum((l) => l.rushAttempts);
  const rec = sum((l) => Math.max(l.targets, l.receptions));
  if (pass >= 5 * Math.max(1, logs.length)) return "QB";
  if (rush + rec === 0) return null;
  return rush > rec ? "RB" : "WR";
}

/** A real role in the offense lately: a starting QB, a back with carries, a receiver with targets. */
function nflUsageCounts(position: string | null, logs: { passAttempts: number; rushAttempts: number; receptions: number; targets: number }[]): boolean {
  if (logs.length < 2) return false;
  const avg = (f: (l: (typeof logs)[number]) => number) => logs.reduce((a, l) => a + f(l), 0) / logs.length;
  if (position === "QB") return avg((l) => l.passAttempts) >= 15;
  if (position === "RB") return avg((l) => l.rushAttempts + l.receptions) >= 6;
  // Older box scores logged no targets (0): receptions stand in.
  return avg((l) => Math.max(l.targets, l.receptions)) >= 2.5;
}

/** Recent games a team's scoring baseline averages over. */
const TEAM_POINTS_GAMES = 17;

/** Each team's points per game over its last TEAM_POINTS_GAMES finished games. */
async function nflTeamPoints(teams: { id: string; abbreviation: string }[], before: Date): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    teams.map(async (t) => {
      const games = await prisma.game.findMany({
        where: {
          sport: "nfl",
          status: "final",
          scheduledStartUtc: { lt: before },
          OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }],
          homeScore: { not: null },
          awayScore: { not: null },
        },
        orderBy: { scheduledStartUtc: "desc" },
        take: TEAM_POINTS_GAMES,
        select: { homeTeamId: true, homeScore: true, awayScore: true },
      });
      if (games.length >= 4) out[t.abbreviation] = games.reduce((a, g) => a + (g.homeTeamId === t.id ? g.homeScore! : g.awayScore!), 0) / games.length;
    })
  );
  return out;
}

/** ESPN's NFL headshot, keyed by athlete id. */
export function nflHeadshotUrl(espnAthleteId: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnAthleteId}.png&w=192&h=140&scale=crop`;
}

function team(t: { abbreviation: string; name: string } | null): SlateTeam | null {
  return t ? { abbreviation: t.abbreviation, name: t.name, logoUrl: espnTeamLogoUrl("nfl", t.abbreviation) } : null;
}

const MIN_DEFENSE_GAMES = 4;
const STAT_SUMS = Object.fromEntries(COLUMNS.map((c) => [c, true])) as Record<(typeof COLUMNS)[number], true>;

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
  const zero = (): NflStatLine => ({ ...(Object.fromEntries(COLUMNS.map((c) => [c, 0])) as unknown as NflStatLine), ...emptyNflExtras() });

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

/** Touches + targets per game that make an absence matter to teammates (any QB counts). */
const KEY_USAGE = 6;

async function nflAbsences(
  games: SlateGame[],
  injuries: { espnAthleteId: string; teamName: string; status: string }[],
  season: number,
  before: Date
): Promise<Record<string, Absence[]>> {
  const teamNames = new Map(games.flatMap((g) => [[g.home.name, g.home.abbreviation], [g.away.name, g.away.abbreviation]] as const));
  const injured = injuries.filter((i) => teamNames.has(i.teamName) && ["out", "doubtful"].includes(injuryLevel(i.status) ?? ""));
  if (injured.length === 0) return {};
  const players = await prisma.nflPlayer.findMany({
    where: { espnAthleteId: { in: injured.map((i) => i.espnAthleteId) } },
    include: {
      gameLogs: {
        where: { season: { in: [season - 1, season] }, gameDate: { lt: before } },
        select: { gameDate: true, passAttempts: true, rushAttempts: true, targets: true, team: { select: { name: true } } },
      },
    },
  });
  const out: Record<string, Absence[]> = {};
  for (const i of injured) {
    const p = players.find((x) => x.espnAthleteId === i.espnAthleteId);
    const abbr = teamNames.get(i.teamName);
    if (!p || !abbr) continue;
    const withTeam = p.gameLogs.filter((l) => l.team.name === i.teamName);
    if (withTeam.length === 0) continue;
    const qb = nflPositionGroup(p.position) === "QB";
    const usage = withTeam.reduce((a, l) => a + (qb ? l.passAttempts : l.rushAttempts + l.targets), 0) / withTeam.length;
    if (!qb && usage < KEY_USAGE) continue;
    (out[abbr] ??= []).push({ name: p.fullName, status: i.status, playedDates: withTeam.map((l) => etDateOf(l.gameDate)), usage });
  }
  return out;
}

/** The coming week's NFL props (games starting from three hours ago through seven days out). */
export const getNflPropsSlate = cache(async (now: Date = new Date()): Promise<NflPropsSlate> => {
  const season = NFL_LEAGUE.seasonOf(now);
  const games = await prisma.game.findMany({
    where: {
      sport: "nfl",
      scheduledStartUtc: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 7 * 86_400_000) },
      status: { not: "final" },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  const empty: NflPropsSlate = { season, games: [], players: {}, logs: {}, usage: {}, props: [], defense: { season, fromLastSeason: false, teams: {} }, absences: {}, lines: {}, teamPoints: {}, modelWeights: {}, lastPolledAt: null };
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
        injury: null,
      };
    }
    const key = `${p.id}:${line.stat}`;
    const prop = props.get(key) ?? { playerId: p.id, stat: line.stat, quotes: [] };
    prop.quotes.push({ bookKey: line.bookKey, bookName: line.book.displayName, side: line.side === "under" ? "under" : "over", point: line.point, priceAmerican: line.priceAmerican });
    props.set(key, prop);
  }

  // Every skill player in the week's games, posted or not: books post most of the
  // week's props midweek, and until then each row reads against ARCHR's own line.
  const roster = await prisma.nflPlayer.findMany({
    // Position too: most players' isn't on file until a roster sync, so it's read off their logs when missing.
    where: { teamId: { in: games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((id): id is string => id !== null) }, OR: [{ position: null }, { position: { in: ["QB", "RB", "WR", "TE"] } }] },
    include: {
      gameLogs: {
        where: { gameDate: { lt: now, gte: new Date(now.getTime() - 70 * 86_400_000) } },
        select: { passAttempts: true, rushAttempts: true, receptions: true, targets: true },
        orderBy: { gameDate: "desc" },
        take: 6,
      },
    },
  });
  const espnIdOf = new Map<string, string>();
  for (const p of roster) {
    espnIdOf.set(p.id, p.espnAthleteId);
    const position = p.position ?? inferNflPosition(p.gameLogs);
    if (players[p.id] || !position || !nflUsageCounts(position, p.gameLogs)) continue;
    const g = games.find((x) => x.homeTeamId === p.teamId || x.awayTeamId === p.teamId)!;
    const venue = p.teamId === g.homeTeamId ? "home" : "away";
    players[p.id] = {
      id: p.id,
      name: p.fullName,
      headshotUrl: nflHeadshotUrl(p.espnAthleteId),
      position: nflPositionGroup(position),
      gameId: g.id,
      team: venue === "home" ? team(g.homeTeam) : team(g.awayTeam),
      opponent: venue === "home" ? team(g.awayTeam) : team(g.homeTeam),
      venue,
      injury: null,
    };
  }

  const [history, defense] = await Promise.all([
    prisma.nflPlayerGameLog.findMany({
      where: { nflPlayerId: { in: Object.keys(players) }, gameDate: { lt: now }, season: { in: [season - 1, season] } },
      orderBy: { gameDate: "desc" },
      include: { game: { select: { homeTeam: { select: { abbreviation: true } }, awayTeam: { select: { abbreviation: true } } } } },
    }),
    getNflDefenseTable(season),
  ]);
  // Each game's team volume, so the sheet can read a player's share of it.
  const teamVolume = await prisma.nflPlayerGameLog.groupBy({
    by: ["gameId", "teamId"],
    where: { gameId: { in: [...new Set(history.map((h) => h.gameId))] } },
    _sum: { targets: true, rushAttempts: true, passAttempts: true },
  });
  const volumeOf = new Map(teamVolume.map((t) => [`${t.gameId}|${t.teamId}`, [t._sum.targets ?? 0, t._sum.rushAttempts ?? 0, t._sum.passAttempts ?? 0] as [number, number, number]]));
  const logs: Record<string, PackedNflLog[]> = {};
  const usage: Record<string, [number, number, number][]> = {};
  for (const h of history) {
    (usage[h.nflPlayerId] ??= []).push(volumeOf.get(`${h.gameId}|${h.teamId}`) ?? [0, 0, 0]);
    const point: NflLogPoint = {
      date: etDateOf(h.gameDate),
      opponent: (h.isHome ? h.game.awayTeam?.abbreviation : h.game.homeTeam?.abbreviation) ?? "",
      isHome: h.isHome,
      season: h.season,
      ...(Object.fromEntries([...COLUMNS, ...NFL_EXTRA_COLUMNS].map((c) => [c, h[c]])) as unknown as NflStatLine),
    };
    (logs[h.nflPlayerId] ??= []).push(packNflLog(point));
  }

  const injuries = await prisma.playerInjury.findMany({ where: { sport: "nfl" } });
  const injuryById = new Map(injuries.map((i) => [i.espnAthleteId, i]));
  for (const l of lines) espnIdOf.set(l.nflPlayer.id, l.nflPlayer.espnAthleteId);
  for (const player of Object.values(players)) {
    const i = injuryById.get(espnIdOf.get(player.id) ?? "");
    if (i) player.injury = { status: i.status, detail: i.detail, level: injuryLevel(i.status) };
  }
  const [absences, gameLines, teamPoints, modelWeights] = await Promise.all([
    nflAbsences(slateGames, injuries, season, now),
    getConsensusGameLines(slateGames.map((g) => g.id)),
    nflTeamPoints(games.flatMap((g) => [g.homeTeam, g.awayTeam].filter((t) => t !== null)), now),
    getModelWeights("nfl"),
  ]);

  // ARCHR's line for each position's core stats a book hasn't posted (out / doubtful players sit out).
  const inputs = { defense, absences, lines: gameLines, teamPoints };
  for (const player of Object.values(players)) {
    const level = player.injury?.level;
    if (level === "out" || level === "doubtful" || !player.position) continue;
    const unpacked = (logs[player.id] ?? []).map(unpackNflLog);
    for (const key of NFL_PROJECTED_STATS[player.position] ?? []) {
      if (props.has(`${player.id}:${key}`)) continue;
      const stat = NFL_PROP_STAT_BY_KEY.get(key)!;
      const proj = projectNflProp(unpacked, stat, { season, ...nflProjectionContext(inputs, player) });
      if (!proj) continue;
      if (stat.shape === "anytime" ? proj.mean < 0.15 : proj.mean < 1) continue;
      props.set(`${player.id}:${key}`, { playerId: player.id, stat: key, quotes: [], projectedPoint: stat.shape === "anytime" ? 0.5 : projectedLine(proj.mean) });
    }
  }

  return {
    season,
    games: slateGames,
    players,
    logs,
    usage,
    props: [...props.values()],
    defense,
    absences,
    lines: gameLines,
    teamPoints,
    modelWeights,
    lastPolledAt: lastPolledAt?.toISOString() ?? null,
  };
});

/** The week's NFL props whose best price beats the market's fair price, biggest edge first, one per player — for the lobby's value board. */
export async function getValueNflProps(limit = 6) {
  const slate = await getNflPropsSlate();
  const out: {
    key: string;
    label: string;
    sub: string;
    href: string;
    price: number;
    bookKey: string;
    ev: number;
    fairAmerican: number;
    booksUsed: number;
    playerId: string;
  }[] = [];
  for (const prop of slate.props) {
    const player = slate.players[prop.playerId];
    const stat = NFL_PROP_STAT_BY_KEY.get(prop.stat);
    if (!player || !stat) continue;
    if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
    const logs = (slate.logs[prop.playerId] ?? []).map(unpackNflLog);
    for (const side of ["over", "under"] as const) {
      const s = summarizeNflProp(prop, logs, stat, side, {
        season: slate.season,
        venue: player.venue,
        opponent: player.opponent?.abbreviation ?? null,
        projection: nflProjectionContext(slate, player),
        injury: player.injury?.level ?? null,
        modelWeight: slate.modelWeights[prop.stat],
      });
      const best = s && (side === "over" ? s.over : s.under);
      const value = s && (side === "over" ? s.value.over : s.value.under);
      if (!s || !best || !value || value.ev < EV_FLAG) continue;
      const what = stat.shape === "anytime" ? `${side === "over" ? "TD" : "No TD"}` : `${side === "over" ? "O" : "U"} ${s.point} ${stat.shortLabel}`;
      out.push({
        key: `nfl:${prop.playerId}:${prop.stat}:${side}`,
        label: `${player.name} ${what}`,
        sub: `${player.venue === "home" ? "vs" : "@"} ${player.opponent?.abbreviation ?? ""} · ${s.l5.hits}/${s.l5.sampleSize} L5`,
        href: `/nfl/${player.gameId}?tab=props`,
        price: best.priceAmerican,
        bookKey: best.bookKey,
        ev: value.ev,
        fairAmerican: value.fairAmerican,
        booksUsed: value.booksUsed,
        playerId: prop.playerId,
      });
    }
  }
  out.sort((a, b) => b.ev - a.ev);
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.playerId) && seen.add(p.playerId)).slice(0, limit);
}
