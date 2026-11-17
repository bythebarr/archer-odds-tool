/**
 * The NBA props walk-forward replay, shared by backtest:nba-props and the
 * shadow-model lab (lab:nba-shadow): every box score from the database, with
 * as-of builders that rebuild the LIVE projection's context for any player-game
 * from what was known before that date only:
 *
 *   - the defense table from games before that date (defenseTableFromSums,
 *     the slate's own builder), so matchup and pace are real, not neutral
 *   - availability reconstructed from the logs themselves: a rotation player
 *     (≥18 minutes over his team's previous 10 games, 5+ of them — the
 *     slate's ROTATION_MINUTES rule) with no game that night was out, feeding
 *     both the with/without splits and, through nbaPlayerImpact, the
 *     opponent-absence lift on the other side
 *   - position rates as of the date (the thin-sample prior), his team's
 *     recent dates (rest and returns), and the game environment from the
 *     game's closing spread and total (both known before tip) against the
 *     team's scoring before it
 *
 * Reconstructed availability uses who actually sat that night, which the
 * injury report usually (not always) announces before tip: it is the one
 * input that can be a little better informed than a live projection was.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import type { ProjectionContext } from "@/lib/nba/projection";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import type { DefenseTable } from "@/lib/nba/matchup";
import { defenseTableFromSums, type DefenseSumRow } from "@/lib/queries/nbaProps";
import { positionGroup, type PositionGroup } from "@/lib/nba/positionGroups";
import type { Absence } from "@/lib/injuries/absence";
import { nbaPlayerImpact, type MissingPlayer } from "@/lib/gameModel/adjust";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { closingGameLines, teamBaselinesByGame } from "./history";

/** Average minutes over his team's recent games that make a player a rotation absence (the slate's rule). */
const ROTATION_MINUTES = 18;
/** Team games looked back over to decide who belongs to the rotation (the minutes backtest's window). */
const ROTATION_WINDOW = 10;
/** A rotation player needs at least this many of those games to count as established. */
const ROTATION_MIN_GAMES = 5;

export type ReplayLog = GameLogPoint & { gameId: string; playerId: string; teamAbbr: string; group: PositionGroup | null };

/** An ET date `days` earlier (negative) or later, YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface NbaReplay {
  /** Each player's games played (minutes > 0), oldest first. */
  byPlayer: Map<string, ReplayLog[]>;
  rows: number;
  /** The closing spread and total of a game (NO_LINES without them). */
  linesOf(gameId: string): GameLines;
  /** The live projection's context for `game`, from what was known before its date. */
  contextFor(game: ReplayLog): ProjectionContext;
  /** Rotation teammates who sat that night (the context's absences). */
  absencesFor(teamAbbr: string, date: string): Absence[];
}

export async function loadNbaReplay(): Promise<NbaReplay> {
  const rows = await prisma.nbaPlayerGameLog.findMany({
    where: { minutes: { gt: 0 } },
    orderBy: [{ gameDate: "asc" }],
    select: {
      gameId: true,
      nbaPlayerId: true,
      teamId: true,
      positionGroup: true,
      gameDate: true,
      season: true,
      isHome: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      threesMade: true,
      steals: true,
      blocks: true,
      turnovers: true,
      starter: true,
    },
  });
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const [games, teams, players, closing, baselines] = await Promise.all([
    prisma.game.findMany({ where: { id: { in: gameIds } }, select: { id: true, homeTeamId: true, awayTeamId: true } }),
    prisma.team.findMany({ select: { id: true, abbreviation: true } }),
    prisma.nbaPlayer.findMany({ select: { id: true, fullName: true } }),
    closingGameLines("nba"),
    teamBaselinesByGame("nba", 30),
  ]);
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const nameOf = new Map(players.map((p) => [p.id, p.fullName]));
  const gameById = new Map(games.map((g) => [g.id, g]));

  const byPlayer = new Map<string, ReplayLog[]>();
  const logsByDate = new Map<string, ReplayLog[]>();
  const sums = new Map<string, DefenseSumRow & { date: string }>();
  const teamGamePlayers = new Map<string, Set<string>>(); // `${teamAbbr}|${date}` → players who played
  const teamDates = new Map<string, string[]>(); // teamAbbr → its game dates, ascending
  for (const r of rows) {
    const g = gameById.get(r.gameId);
    const teamAbbr = abbr.get(r.teamId);
    if (!g || !teamAbbr) continue;
    const oppId = r.teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
    const date = etDateOf(r.gameDate);
    const log: ReplayLog = {
      gameId: r.gameId,
      playerId: r.nbaPlayerId,
      teamAbbr,
      group: positionGroup(r.positionGroup),
      date,
      opponent: (oppId && abbr.get(oppId)) ?? "",
      isHome: r.isHome,
      season: r.season,
      minutes: r.minutes,
      points: r.points,
      rebounds: r.rebounds,
      assists: r.assists,
      threesMade: r.threesMade,
      steals: r.steals,
      blocks: r.blocks,
      turnovers: r.turnovers,
      team: teamAbbr,
      starter: r.starter,
    };
    const list = byPlayer.get(r.nbaPlayerId) ?? [];
    // One row per player per game; a duplicated log would double-count.
    if (list.length === 0 || list[list.length - 1].gameId !== r.gameId) {
      list.push(log);
      (logsByDate.get(date) ?? logsByDate.set(date, []).get(date)!).push(log);
    }
    byPlayer.set(r.nbaPlayerId, list);
    const key = `${r.gameId}|${r.teamId}|${r.positionGroup}`;
    const row = sums.get(key) ?? { season: r.season, gameId: r.gameId, teamId: r.teamId, positionGroup: r.positionGroup, date, _sum: {} };
    for (const c of ["points", "rebounds", "assists", "threesMade", "steals", "blocks", "turnovers"] as const) row._sum[c] = (row._sum[c] ?? 0) + r[c];
    sums.set(key, row);
    const tg = `${teamAbbr}|${date}`;
    if (!teamGamePlayers.has(tg)) {
      teamGamePlayers.set(tg, new Set());
      const dates = teamDates.get(teamAbbr) ?? [];
      dates.push(date);
      teamDates.set(teamAbbr, dates);
    }
    teamGamePlayers.get(tg)!.add(r.nbaPlayerId);
  }
  const sumRows = [...sums.values()];

  // ---- As-of builders, each cached per team/date ---------------------------
  const defenseCache = new Map<string, DefenseTable>();
  const defenseAsOf = (date: string, season: number): DefenseTable => {
    const key = `${date}|${season}`;
    const hit = defenseCache.get(key);
    if (hit) return hit;
    const table = defenseTableFromSums(
      sumRows.filter((r) => r.date < date),
      abbr,
      season
    );
    defenseCache.set(key, table);
    return table;
  };

  const absenceCache = new Map<string, { absence: Absence; playerId: string }[]>();
  /** Who sat that night for this team, reconstructed from the logs (see header). */
  const absencesDetailedFor = (teamAbbr: string, date: string): { absence: Absence; playerId: string }[] => {
    const key = `${teamAbbr}|${date}`;
    const hit = absenceCache.get(key);
    if (hit) return hit;
    const dates = teamDates.get(teamAbbr) ?? [];
    const idx = dates.indexOf(date);
    const out: { absence: Absence; playerId: string }[] = [];
    if (idx > 0) {
      const prev = dates.slice(Math.max(0, idx - ROTATION_WINDOW), idx);
      const tonight = teamGamePlayers.get(`${teamAbbr}|${date}`) ?? new Set<string>();
      const minutesIn = (pid: string, d: string) => byPlayer.get(pid)?.find((l) => l.date === d && l.teamAbbr === teamAbbr)?.minutes ?? 0;
      const recent = new Map<string, number[]>();
      for (const d of prev)
        for (const pid of teamGamePlayers.get(`${teamAbbr}|${d}`) ?? []) {
          const m = minutesIn(pid, d);
          if (m > 0) (recent.get(pid) ?? recent.set(pid, []).get(pid)!).push(m);
        }
      for (const [pid, mins] of recent) {
        if (tonight.has(pid) || mins.length < ROTATION_MIN_GAMES) continue;
        const usage = mins.reduce((a, b) => a + b, 0) / mins.length;
        if (usage < ROTATION_MINUTES) continue;
        const playedDates = (byPlayer.get(pid) ?? []).filter((l) => l.teamAbbr === teamAbbr && l.date < date).map((l) => l.date);
        out.push({ absence: { name: nameOf.get(pid) ?? pid, status: "out", playedDates, usage }, playerId: pid });
      }
    }
    absenceCache.set(key, out);
    return out;
  };
  const absencesFor = (teamAbbr: string, date: string): Absence[] => absencesDetailedFor(teamAbbr, date).map((d) => d.absence);

  const impactCache = new Map<string, MissingPlayer[]>();
  /** A team's absences in impact form for the OTHER side's projection (a log absence reads as fully out). */
  const impactsFor = (teamAbbr: string, date: string): MissingPlayer[] => {
    const key = `${teamAbbr}|${date}`;
    const hit = impactCache.get(key);
    if (hit) return hit;
    const out: MissingPlayer[] = [];
    for (const { absence, playerId } of absencesDetailedFor(teamAbbr, date)) {
      const logs = (byPlayer.get(playerId) ?? []).filter((l) => l.teamAbbr === teamAbbr && l.date < date);
      const impact = nbaPlayerImpact(logs);
      if (impact > 0) out.push({ name: absence.name, status: absence.status, impact: Math.max(impact, 0.3) });
    }
    impactCache.set(key, out);
    return out;
  };

  // Position rates as of each date: running sums per group, advanced date by date.
  const ratesAsOf = new Map<string, Record<string, Record<string, number>>>();
  {
    const running = new Map<PositionGroup, { minutes: number; totals: Map<string, number> }>();
    for (const date of [...logsByDate.keys()].sort()) {
      const snapshot: Record<string, Record<string, number>> = {};
      for (const [group, s] of running) {
        if (s.minutes < 500) continue;
        snapshot[group] = Object.fromEntries(NBA_PROP_STATS.filter((st) => !st.milestone).map((st) => [st.key, (s.totals.get(st.key) ?? 0) / s.minutes]));
      }
      ratesAsOf.set(date, snapshot);
      for (const l of logsByDate.get(date) ?? []) {
        if (!l.group) continue;
        const s = running.get(l.group) ?? { minutes: 0, totals: new Map<string, number>() };
        s.minutes += l.minutes;
        for (const st of NBA_PROP_STATS) if (!st.milestone) s.totals.set(st.key, (s.totals.get(st.key) ?? 0) + st.value(l));
        running.set(l.group, s);
      }
    }
  }

  const linesOf = (gameId: string) => closing.get(gameId) ?? NO_LINES;
  return {
    byPlayer,
    rows: rows.length,
    linesOf,
    absencesFor,
    contextFor(game) {
      const base = baselines.get(game.gameId);
      return {
        defense: defenseAsOf(game.date, game.season),
        opponent: game.opponent || null,
        positionGroup: game.group,
        absences: absencesFor(game.teamAbbr, game.date),
        opponentAbsences: game.opponent ? impactsFor(game.opponent, game.date) : [],
        lines: linesOf(game.gameId),
        isHome: game.isHome,
        baselineTotal: (game.isHome ? base?.home : base?.away)?.combined ?? null,
        season: game.season,
        date: game.date,
        team: game.teamAbbr,
        teamDates: (teamDates.get(game.teamAbbr) ?? []).filter((d) => d < game.date && d >= shiftDate(game.date, -21)),
        positionRates: game.group ? ratesAsOf.get(game.date)?.[game.group] : undefined,
      };
    },
  };
}
