import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { probOver, projectProp } from "@/lib/nba/projection";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import type { DefenseTable } from "@/lib/nba/matchup";
import { defenseTableFromSums, type DefenseSumRow } from "@/lib/queries/nbaProps";
import { positionGroup, type PositionGroup } from "@/lib/nba/positionGroups";
import type { Absence } from "@/lib/injuries/absence";
import { nbaPlayerImpact, type MissingPlayer } from "@/lib/gameModel/adjust";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { NO_LINES } from "@/lib/propModel/environment";
import { closingGameLines, teamBaselinesByGame } from "./props/history";

/**
 * Backtest for the NBA prop projection (projection.ts). Every logged game with
 * at least 10 earlier games for that player is projected from those earlier
 * games only — no lookahead — against a stand-in line: the player's L10
 * average rounded to the nearest .5, which is roughly where books hang a main
 * line. Reports, per stat:
 *   - projection error (MAE) next to the L10 average's, the naive baseline
 *   - calibration of the model's favored side at the stand-in line (Brier vs
 *     base rate, reliability buckets, and the logit shrink that would fit)
 *
 * The projection graded is the LIVE one — the same circumstantial stack the
 * finder runs, rebuilt as of each date:
 *   - the defense table from games before that date (defenseTableFromSums,
 *     the slate's own builder), so matchup and pace are real, not neutral
 *   - availability reconstructed from the logs themselves: a rotation player
 *     (≥18 minutes over his team's previous 10 games — the slate's
 *     ROTATION_MINUTES rule, and the reconstruction the minutes backtest
 *     already uses) with no game that night was out, feeding both the
 *     with/without splits and, through nbaPlayerImpact, the opponent-absence
 *     lift on the other side
 *   - position rates as of the date (the thin-sample prior), his team's
 *     recent dates (rest and returns), and the game environment from the
 *     game's closing spread and total against the team's scoring before it
 * Beside it, the report keeps the REDUCED projection this backtest used to
 * grade (matchup and pace neutral, no availability) and the no-lines
 * projection, so what the stack adds stays visible. Graded against real book
 * prices: `npm run backtest:props-market`.
 *
 * Run: `npm run backtest:nba-props` (optionally `N=40000`).
 */
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists"] as const;
const NEUTRAL: DefenseTable = { season: 0, fromLastSeason: false, teams: {} };
/** Average minutes over his team's recent games that make a player a rotation absence (the slate's rule). */
const ROTATION_MINUTES = 18;
/** Team games looked back over to decide who belongs to the rotation (the minutes backtest's window). */
const ROTATION_WINDOW = 10;
/** A rotation player needs at least this many of those games to count as established. */
const ROTATION_MIN_GAMES = 5;

type Log = GameLogPoint & { gameId: string; playerId: string; teamAbbr: string; group: PositionGroup | null };

/** An ET date `days` earlier (negative) or later, YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const limit = Number(process.env.N ?? 30000);
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

  const byPlayer = new Map<string, Log[]>();
  const logsByDate = new Map<string, Log[]>();
  const sums = new Map<string, DefenseSumRow & { date: string }>();
  const teamGamePlayers = new Map<string, Set<string>>(); // `${teamAbbr}|${date}` → players who played
  const teamDates = new Map<string, string[]>(); // teamAbbr → its game dates, ascending
  for (const r of rows) {
    const g = gameById.get(r.gameId);
    const teamAbbr = abbr.get(r.teamId);
    if (!g || !teamAbbr) continue;
    const oppId = r.teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
    const date = etDateOf(r.gameDate);
    const log: Log = {
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
  console.log(`${rows.length} player-games from ${byPlayer.size} players.`);

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
        snapshot[group] = Object.fromEntries(
          NBA_PROP_STATS.filter((st) => !st.milestone).map((st) => [st.key, (s.totals.get(st.key) ?? 0) / s.minutes])
        );
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

  for (const key of STATS) {
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let reducedErr = 0;
    let noLinesErr = 0;
    let naiveErr = 0;
    let withLines = 0;
    let withAbsences = 0;
    let withOpponentAbsences = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 10; i < games.length; i++) {
        const history = games.slice(0, i).reverse(); // most recent first, before game i
        const l10 = history.slice(0, 10).reduce((a, g) => a + stat.value(g), 0) / 10;
        if (l10 < 1) continue; // a line nobody hangs
        const line = Math.round(l10 - 0.5) + 0.5;
        const game = games[i];
        const lines = closing.get(game.gameId) ?? NO_LINES;
        const base = baselines.get(game.gameId);
        const absences = absencesFor(game.teamAbbr, game.date);
        const opponentAbsences = game.opponent ? impactsFor(game.opponent, game.date) : [];
        const recentDates = (teamDates.get(game.teamAbbr) ?? []).filter((d) => d < game.date && d >= shiftDate(game.date, -21));
        const proj = projectProp(history, stat, {
          defense: defenseAsOf(game.date, game.season),
          opponent: game.opponent || null,
          positionGroup: game.group,
          absences,
          opponentAbsences,
          lines,
          isHome: game.isHome,
          baselineTotal: (game.isHome ? base?.home : base?.away)?.combined ?? null,
          season: game.season,
          date: game.date,
          team: game.teamAbbr,
          teamDates: recentDates,
          positionRates: game.group ? ratesAsOf.get(game.date)?.[game.group] : undefined,
        });
        const reduced = projectProp(history, stat, {
          defense: NEUTRAL,
          opponent: null,
          positionGroup: null,
          lines,
          isHome: game.isHome,
          baselineTotal: (game.isHome ? base?.home : base?.away)?.combined ?? null,
          season: game.season,
        });
        const plain = projectProp(history, stat, { defense: NEUTRAL, opponent: null, positionGroup: null });
        if (!proj || !reduced || !plain) continue;
        const actual = stat.value(game);
        if (lines.total !== null) withLines++;
        if (absences.length > 0) withAbsences++;
        if (opponentAbsences.length > 0) withOpponentAbsences++;
        modelErr += Math.abs(proj.mean - actual);
        reducedErr += Math.abs(reduced.mean - actual);
        noLinesErr += Math.abs(plain.mean - actual);
        naiveErr += Math.abs(l10 - actual);
        n++;
        const pOver = probOver(proj, line);
        const overFav = pOver >= 0.5;
        samples.push({ pred: overFav ? pOver : 1 - pOver, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    samples.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first, for the time-split refit
    const report = scoreCalibration(samples.slice(0, limit));
    console.log(
      `\n${stat.label}: LIVE projection MAE ${(modelErr / n).toFixed(3)} vs reduced ${(reducedErr / n).toFixed(3)}, without game lines ${(noLinesErr / n).toFixed(3)}, L10-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games (${withLines} with closing lines, ${withAbsences} with a teammate out, ${withOpponentAbsences} with an opponent out)`
    );
    console.log(formatCalibrationReport(`NBA ${stat.shortLabel} projection`, "player-game", report));
    await saveReport(`nba-props:${key}`, `NBA props — ${stat.label}`, "player-game", report, {
      projectionMae: modelErr / n,
      reducedMae: reducedErr / n,
      baselineMae: naiveErr / n,
      baseline: "L10 average",
      noLinesMae: noLinesErr / n,
      gamesWithLines: withLines,
      gamesWithAbsences: withAbsences,
      gamesWithOpponentAbsences: withOpponentAbsences,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
