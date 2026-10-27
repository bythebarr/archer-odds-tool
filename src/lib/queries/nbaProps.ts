import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { espnTeamLogoUrl, nbaHeadshotUrl } from "@/lib/logos";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { packLog, projectedLine, summarizeProp, type GameLogPoint, type PackedLog, type SlateProp } from "@/lib/nba/propsMath";
import { projectProp } from "@/lib/nba/projection";
import { nbaProjectionContext } from "@/lib/nba/slateContext";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import type { DefenseTable, TeamDefenseRow } from "@/lib/nba/matchup";
import { EV_FLAG } from "@/lib/odds/marketValue";
import { injuryLevel, type PlayerInjuryInfo } from "@/lib/injuries/status";
import type { Absence } from "@/lib/injuries/absence";
import { positionGroup, type PositionGroup } from "@/lib/nba/positionGroups";
import type { NbaPropStat } from "@/generated/prisma/client";
import type { GameLines } from "@/lib/propModel/environment";
import { getConsensusGameLines } from "./gameLines";
import { getModelWeights } from "./modelWeights";

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
  /** G / F / C, for defense by position; null until the player's position is known. */
  positionGroup: PositionGroup | null;
  /** On tonight's injury report; null when he isn't. */
  injury: PlayerInjuryInfo | null;
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
  /** Per team abbreviation: rotation players ruled out or doubtful tonight (see injuries/absence). */
  absences: Record<string, Absence[]>;
  /** Game id → tonight's consensus spread and total (the projection's game environment). */
  lines: Record<string, GameLines>;
  /** Stat → the model's fitted weight against the market (stats without a fit use the default). */
  modelWeights: Record<string, number>;
  lastPolledAt: string | null;
}

/** The slate as sent to the browser: logs packed as tuples (see PackedLog). */
export type WireNbaPropsSlate = Omit<NbaPropsSlate, "logs"> & { logs: Record<string, PackedLog[]> };

export function toWireSlate(slate: NbaPropsSlate): WireNbaPropsSlate {
  return { ...slate, logs: Object.fromEntries(Object.entries(slate.logs).map(([id, logs]) => [id, logs.map(packLog)])) };
}

/** Stats ARCHR posts its own line on before the books do: the ones books always hang. */
const PROJECTED_STATS: NbaPropStat[] = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"];
/** A player projected before the books post: recent minutes like a rotation player's. */
const ROTATION_MINUTES_PROJECTED = 15;
const ROSTER_LOOKBACK_DAYS = 40;

/** Average minutes that make an absence matter to teammates' projections. */
const ROTATION_MINUTES = 18;

/**
 * Per team on the slate: players ruled out or doubtful tonight who play real
 * minutes, with the dates they've played for that team (two seasons) — the raw
 * material for teammates' with/without splits.
 */
async function nbaAbsences(games: SlateGame[], season: number, before: Date): Promise<Record<string, Absence[]>> {
  const teamNames = new Map(games.flatMap((g) => [[g.home.name, g.home.abbreviation], [g.away.name, g.away.abbreviation]] as const));
  const injured = (await prisma.playerInjury.findMany({ where: { sport: "nba", teamName: { in: [...teamNames.keys()] } } })).filter((i) => {
    const level = injuryLevel(i.status);
    return level === "out" || level === "doubtful";
  });
  if (injured.length === 0) return {};
  const players = await prisma.nbaPlayer.findMany({
    where: { espnAthleteId: { in: injured.map((i) => i.espnAthleteId) } },
    include: {
      team: { select: { name: true } },
      gameLogs: { where: { season: { in: [season - 1, season] }, gameDate: { lt: before } }, select: { gameDate: true, minutes: true, team: { select: { name: true } } } },
    },
  });
  const out: Record<string, Absence[]> = {};
  for (const i of injured) {
    const p = players.find((x) => x.espnAthleteId === i.espnAthleteId);
    const abbr = teamNames.get(i.teamName);
    if (!p || !abbr) continue;
    const withTeam = p.gameLogs.filter((l) => l.team.name === i.teamName);
    if (withTeam.length === 0) continue;
    const usage = withTeam.reduce((a, l) => a + l.minutes, 0) / withTeam.length;
    if (usage < ROTATION_MINUTES) continue;
    (out[abbr] ??= []).push({ name: p.fullName, status: i.status, playedDates: withTeam.map((l) => etDateOf(l.gameDate)), usage });
  }
  return out;
}

/** Below this many games a team's season-to-date defense is noise; read last season instead. */
const MIN_DEFENSE_GAMES = 10;

/**
 * Every team's defense and pace from the box scores: per game, what opponents
 * score against it (each prop stat's columns) and both teams' combined points.
 * The current season once teams have played enough games, else last season.
 */
export async function getNbaDefenseTable(season: number): Promise<DefenseTable> {
  // One row per game, team and position group (null = position unknown).
  const sums = await prisma.nbaPlayerGameLog.groupBy({
    by: ["season", "gameId", "teamId", "positionGroup"],
    where: { season: { in: [season - 1, season] } },
    _sum: { points: true, rebounds: true, assists: true, threesMade: true, steals: true, blocks: true, turnovers: true },
  });
  const abbr = new Map(
    (await prisma.team.findMany({ where: { id: { in: [...new Set(sums.map((r) => r.teamId))] } }, select: { id: true, abbreviation: true } }))
      .map((t) => [t.id, t.abbreviation])
  );

  type Line = TeamDefenseRow["allowed"];
  const zero = (): Line => ({ points: 0, rebounds: 0, assists: 0, threesMade: 0, steals: 0, blocks: 0, turnovers: 0 });
  const addInto = (into: Line, from: (typeof sums)[number]["_sum"]) => {
    for (const k of Object.keys(into) as (keyof Line)[]) into[k] += from[k] ?? 0;
  };
  const divide = (line: Line, n: number) => {
    for (const k of Object.keys(line) as (keyof Line)[]) line[k] /= n;
  };

  const build = (forSeason: number): Record<string, TeamDefenseRow> => {
    // gameId → teamId → { total, by group }
    const games = new Map<string, Map<string, { total: Line; groups: Map<PositionGroup, Line> }>>();
    for (const r of sums) {
      if (r.season !== forSeason) continue;
      const teams = games.get(r.gameId) ?? new Map();
      const side = teams.get(r.teamId) ?? { total: zero(), groups: new Map<PositionGroup, Line>() };
      addInto(side.total, r._sum);
      const group = positionGroup(r.positionGroup);
      if (group) addInto(side.groups.get(group) ?? side.groups.set(group, zero()).get(group)!, r._sum);
      teams.set(r.teamId, side);
      games.set(r.gameId, teams);
    }

    const acc = new Map<string, TeamDefenseRow>();
    for (const teams of games.values()) {
      if (teams.size !== 2) continue;
      const [[idA, a], [idB, b]] = [...teams.entries()];
      const combined = a.total.points + b.total.points;
      for (const [usId, them] of [[idA, b], [idB, a]] as const) {
        const key = abbr.get(usId);
        if (!key) continue;
        const row = acc.get(key) ?? { games: 0, allowed: zero(), combinedPoints: 0, byPosition: {} };
        row.games += 1;
        row.combinedPoints += combined;
        addInto(row.allowed, them.total);
        // A game counts toward the by-position sums only when the opponent's positions are known.
        if (them.groups.size > 0) {
          for (const g of ["G", "F", "C"] as const) {
            const pos = (row.byPosition[g] ??= { games: 0, allowed: zero() });
            pos.games += 1;
            const line = them.groups.get(g);
            if (line) addInto(pos.allowed, line);
          }
        }
        acc.set(key, row);
      }
    }
    // Totals → per-game averages.
    for (const row of acc.values()) {
      row.combinedPoints /= row.games;
      divide(row.allowed, row.games);
      for (const pos of Object.values(row.byPosition)) divide(pos.allowed, pos.games);
    }
    return Object.fromEntries(acc);
  };

  const current = build(season);
  const counts = Object.values(current).map((t) => t.games).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  if (median >= MIN_DEFENSE_GAMES) return { season, fromLastSeason: false, teams: current };
  const last = build(season - 1);
  return Object.keys(last).length > 0
    ? { season: season - 1, fromLastSeason: true, teams: last }
    : { season, fromLastSeason: false, teams: current };
}

function team(t: { abbreviation: string; name: string } | null): SlateTeam | null {
  return t ? { abbreviation: t.abbreviation, name: t.name, logoUrl: espnTeamLogoUrl("nba", t.abbreviation) } : null;
}

/** Request-cached: the lobby's top-props strip and value board read the same slate. */
export const getNbaPropsSlate = cache(async (dateEt: string): Promise<NbaPropsSlate> => {
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
    absences: {},
    lines: {},
    modelWeights: {},
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
        positionGroup: positionGroup(p.positionGroup),
        injury: null,
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

  // Every rotation player in tonight's games, posted or not: books post props the
  // morning of a game, and until then each row reads against ARCHR's own line.
  const roster = await prisma.nbaPlayer.findMany({
    where: { teamId: { in: games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((id): id is string => id !== null) } },
    include: { gameLogs: { where: { gameDate: { lt: gte, gte: new Date(gte.getTime() - ROSTER_LOOKBACK_DAYS * 86_400_000) } }, select: { minutes: true }, orderBy: { gameDate: "desc" }, take: 10 } },
  });
  const espnIdOf = new Map<string, string>();
  for (const p of roster) {
    espnIdOf.set(p.id, p.espnAthleteId);
    if (players[p.id]) continue;
    const played = p.gameLogs.filter((l) => l.minutes > 0);
    const avgMinutes = played.length ? played.reduce((a, l) => a + l.minutes, 0) / played.length : 0;
    // Over 48 a game is a team aggregate row, not a player.
    if (played.length < 3 || avgMinutes < ROTATION_MINUTES_PROJECTED || avgMinutes > 48) continue;
    const g = games.find((x) => x.homeTeamId === p.teamId || x.awayTeamId === p.teamId)!;
    const venue = p.teamId === g.homeTeamId ? "home" : "away";
    players[p.id] = {
      id: p.id,
      name: p.fullName,
      headshotUrl: nbaHeadshotUrl(p.espnAthleteId),
      gameId: g.id,
      team: venue === "home" ? team(g.homeTeam) : team(g.awayTeam),
      opponent: venue === "home" ? team(g.awayTeam) : team(g.homeTeam),
      venue,
      positionGroup: positionGroup(p.positionGroup),
      injury: null,
    };
  }
  if (Object.keys(players).length === 0) return { ...empty, games: slateGames };

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
      turnovers: h.turnovers,
    });
  }

  const [absences, gameLines, modelWeights] = await Promise.all([
    nbaAbsences(slateGames, season, gte),
    getConsensusGameLines(slateGames.map((g) => g.id)),
    getModelWeights("nba"),
  ]);
  const injuries = await prisma.playerInjury.findMany({ where: { sport: "nba" } });
  const injuryById = new Map(injuries.map((i) => [i.espnAthleteId, i]));
  for (const l of lines) espnIdOf.set(l.nbaPlayer.id, l.nbaPlayer.espnAthleteId);
  for (const player of Object.values(players)) {
    const i = injuryById.get(espnIdOf.get(player.id) ?? "");
    if (i) player.injury = { status: i.status, detail: i.detail, level: injuryLevel(i.status) };
  }

  // ARCHR's line for every core stat a book hasn't posted (out / doubtful players sit out).
  const inputs = { defense, absences, lines: gameLines };
  for (const player of Object.values(players)) {
    const level = player.injury?.level;
    if (level === "out" || level === "doubtful") continue;
    for (const stat of PROJECTED_STATS) {
      if (propsByKey.has(`${player.id}:${stat}`)) continue;
      const proj = projectProp(logs[player.id] ?? [], NBA_PROP_STAT_BY_KEY.get(stat)!, { season, ...nbaProjectionContext(inputs, player) });
      if (!proj || proj.mean < 0.8) continue;
      propsByKey.set(`${player.id}:${stat}`, { playerId: player.id, stat, quotes: [], projectedPoint: projectedLine(proj.mean) });
    }
  }

  return {
    date: dateEt,
    season,
    games: slateGames,
    players,
    logs,
    props: [...propsByKey.values()],
    defense,
    absences,
    lines: gameLines,
    modelWeights,
    lastPolledAt: lastPolledAt?.toISOString() ?? null,
  };
});

export interface ValueProp extends TopProp {
  /** Expected value of the best price against the rest of the market (see marketValue). */
  ev: number;
  fairAmerican: number;
  booksUsed: number;
}

/**
 * The day's props whose best price beats the market's fair price by more than
 * the noise floor, biggest edge first, one per player — the props half of the
 * lobby's value board.
 */
export async function getValueNbaProps(dateEt: string, limit = 6): Promise<ValueProp[]> {
  const slate = await getNbaPropsSlate(dateEt);
  const out: ValueProp[] = [];
  for (const prop of slate.props) {
    const player = slate.players[prop.playerId];
    const stat = NBA_PROP_STAT_BY_KEY.get(prop.stat);
    if (!player || !stat) continue;
    for (const side of ["over", "under"] as const) {
      if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
      const s = summarizeProp(prop, slate.logs[prop.playerId] ?? [], stat, side, { season: slate.season, venue: player.venue, opponent: player.opponent?.abbreviation });
      const best = s && (side === "over" ? s.over : s.under);
      const value = s && (side === "over" ? s.value.over : s.value.under);
      if (!s || !best || !value || value.ev < EV_FLAG) continue;
      out.push({
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
        ev: value.ev,
        fairAmerican: value.fairAmerican,
        booksUsed: value.booksUsed,
      });
    }
  }
  out.sort((a, b) => b.ev - a.ev);
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.playerId) && seen.add(c.playerId)).slice(0, limit);
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
    if (!player || !stat || player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
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
