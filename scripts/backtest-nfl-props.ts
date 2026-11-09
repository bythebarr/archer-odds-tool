import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NFL_PROP_STAT_BY_KEY, nflPositionGroup } from "@/lib/nfl/propStats";
import { nflProbOver, projectNflProp } from "@/lib/nfl/projection";
import { NFL_LOG_COLUMNS, type NflLogPoint } from "@/lib/nfl/propsMath";
import type { NflDefenseTable } from "@/lib/nfl/matchup";
import { inferNflPosition, nflDefenseTableFromSums, type NflDefenseSumRow } from "@/lib/queries/nflProps";
import type { Absence } from "@/lib/injuries/absence";
import { NFL_QB_IMPACT, NFL_SKILL_CAP, NFL_SKILL_IMPACT } from "@/lib/gameModel/adjust";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { NO_LINES } from "@/lib/propModel/environment";
import { closingGameLines, teamBaselinesByGame } from "./props/history";

/**
 * Backtest for the NFL prop projection (src/lib/nfl/projection.ts), the NBA
 * backtest's method: every logged game with 4+ earlier games for that player
 * is projected from those games only, against a stand-in line (his L5 average
 * to the nearest .5; 0.5 for anytime TD). Reports projection MAE next to the
 * L5 average's (and the projection's without game lines), and calibration of
 * the favored side.
 *
 * The projection graded is the LIVE one, rebuilt as of each date: the
 * defense-by-position table from games before that date
 * (nflDefenseTableFromSums, the slate's own builder), and availability
 * reconstructed from the logs — a key player (a QB, or ≥6 touches + targets
 * a game over his team's previous six games, the slate's KEY_USAGE rule)
 * with no game that week was out, feeding the with/without splits and the
 * game-model absence impacts (QB 3, skill 0.6 capped at 2, from his last
 * three team games' shares) that re-read the closing lines. The REDUCED
 * projection this backtest used to grade (matchup neutral, no availability)
 * stays beside it so the stack's contribution stays visible.
 *
 * Run: `npm run backtest:nfl-props`.
 */
const STATS = ["passYards", "rushYards", "recYards", "receptions", "anytimeTd"] as const;
const NEUTRAL: NflDefenseTable = { season: 0, fromLastSeason: false, teams: {} };
/** Touches + targets per game that make an absence matter to teammates (the slate's rule; any QB counts). */
const KEY_USAGE = 6;
/** Team games looked back over to decide who is a key player. */
const ROTATION_WINDOW = 6;
/** A key player needs at least this many of those games to count as established. */
const ROTATION_MIN_GAMES = 3;

type Log = NflLogPoint & { gameId: string; playerId: string; teamAbbr: string; position: string | null };

async function main() {
  const rows = await prisma.nflPlayerGameLog.findMany({ orderBy: [{ gameDate: "asc" }] });
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const [games, teams, players, closing, baselines] = await Promise.all([
    prisma.game.findMany({ where: { id: { in: gameIds } }, select: { id: true, homeTeamId: true, awayTeamId: true } }),
    prisma.team.findMany({ select: { id: true, abbreviation: true } }),
    prisma.nflPlayer.findMany({ select: { id: true, fullName: true } }),
    closingGameLines("nfl"),
    teamBaselinesByGame("nfl", 17),
  ]);
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const nameOf = new Map(players.map((p) => [p.id, p.fullName]));
  const gameById = new Map(games.map((g) => [g.id, g]));

  const byPlayer = new Map<string, Log[]>();
  const sums = new Map<string, NflDefenseSumRow & { date: string }>();
  const teamGamePlayers = new Map<string, Set<string>>();
  const teamGameId = new Map<string, string>(); // `${teamAbbr}|${date}` → gameId
  const teamDates = new Map<string, string[]>();
  const teamGameLogs = new Map<string, typeof rows>(); // `${teamAbbr}|${gameId}` → that team's logs in the game
  for (const r of rows) {
    const g = gameById.get(r.gameId);
    const teamAbbr = abbr.get(r.teamId);
    if (!g || !teamAbbr) continue;
    const oppId = r.teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
    const date = etDateOf(r.gameDate);
    const log: Log = { ...r, gameId: r.gameId, playerId: r.nflPlayerId, teamAbbr, date, opponent: (oppId && abbr.get(oppId)) ?? "", team: teamAbbr };
    const list = byPlayer.get(r.nflPlayerId) ?? [];
    if (list.length === 0 || list[list.length - 1].gameId !== r.gameId) list.push(log);
    byPlayer.set(r.nflPlayerId, list);
    const key = `${r.season}|${r.gameId}|${r.teamId}|${r.position}`;
    const row = sums.get(key) ?? { season: r.season, gameId: r.gameId, teamId: r.teamId, position: r.position, date, _sum: {} };
    for (const c of NFL_LOG_COLUMNS) row._sum[c] = (row._sum[c] ?? 0) + (r[c] ?? 0);
    sums.set(key, row);
    const tg = `${teamAbbr}|${date}`;
    if (!teamGamePlayers.has(tg)) {
      teamGamePlayers.set(tg, new Set());
      teamGameId.set(tg, r.gameId);
      const dates = teamDates.get(teamAbbr) ?? [];
      dates.push(date);
      teamDates.set(teamAbbr, dates);
    }
    teamGamePlayers.get(tg)!.add(r.nflPlayerId);
    const gl = `${teamAbbr}|${r.gameId}`;
    (teamGameLogs.get(gl) ?? teamGameLogs.set(gl, []).get(gl)!).push(r);
  }
  const sumRows = [...sums.values()];
  console.log(`${rows.length} player-games from ${byPlayer.size} players.`);

  const defenseCache = new Map<string, NflDefenseTable>();
  const defenseAsOf = (date: string, season: number): NflDefenseTable => {
    const key = `${date}|${season}`;
    const hit = defenseCache.get(key);
    if (hit) return hit;
    const table = nflDefenseTableFromSums(
      sumRows.filter((r) => r.date < date),
      abbr,
      season
    );
    defenseCache.set(key, table);
    return table;
  };

  const absenceCache = new Map<string, { absence: Absence; playerId: string }[]>();
  /** Who sat that week for this team, reconstructed from the logs (see header). */
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
      const seen = new Map<string, { games: number; usage: number }>();
      for (const d of prev)
        for (const pid of teamGamePlayers.get(`${teamAbbr}|${d}`) ?? []) {
          const g = byPlayer.get(pid)?.find((l) => l.date === d && l.teamAbbr === teamAbbr);
          if (!g) continue;
          const s = seen.get(pid) ?? { games: 0, usage: 0 };
          s.games++;
          s.usage += g.rushAttempts + g.targets;
          seen.set(pid, s);
        }
      for (const [pid, s] of seen) {
        if (tonight.has(pid) || s.games < ROTATION_MIN_GAMES) continue;
        const logs = byPlayer.get(pid) ?? [];
        const pos = nflPositionGroup(logs.find((l) => l.teamAbbr === teamAbbr)?.position ?? null);
        const usage = s.usage / s.games;
        if (pos !== "QB" && usage < KEY_USAGE) continue;
        const playedDates = logs.filter((l) => l.teamAbbr === teamAbbr && l.date < date).map((l) => l.date);
        out.push({ absence: { name: nameOf.get(pid) ?? pid, status: "out", playedDates, usage }, playerId: pid });
      }
    }
    absenceCache.set(key, out);
    return out;
  };
  const absencesFor = (teamAbbr: string, date: string): Absence[] => absencesDetailedFor(teamAbbr, date).map((d) => d.absence);

  const impactCache = new Map<string, number>();
  /** A team's total missing-player impact that week, the game model's read (see header). */
  const impactTotalFor = (teamAbbr: string, date: string): number => {
    const key = `${teamAbbr}|${date}`;
    const hit = impactCache.get(key);
    if (hit !== undefined) return hit;
    const dates = teamDates.get(teamAbbr) ?? [];
    const idx = dates.indexOf(date);
    let total = 0;
    if (idx > 0) {
      const recentDates = dates.slice(Math.max(0, idx - 3), idx);
      const gameIds = recentDates.map((d) => teamGameId.get(`${teamAbbr}|${d}`)).filter((id): id is string => !!id);
      let att = 0;
      let use = 0;
      const mine = new Map<string, { att: number; use: number }>();
      for (const gid of gameIds)
        for (const r of teamGameLogs.get(`${teamAbbr}|${gid}`) ?? []) {
          const u = r.rushAttempts + r.targets + r.receptions;
          att += r.passAttempts;
          use += u;
          const m = mine.get(r.nflPlayerId) ?? { att: 0, use: 0 };
          m.att += r.passAttempts;
          m.use += u;
          mine.set(r.nflPlayerId, m);
        }
      let skill = 0;
      for (const { playerId } of absencesDetailedFor(teamAbbr, date)) {
        const m = mine.get(playerId);
        if (!m) continue;
        if (att > 0 && m.att / att >= 0.6) total += NFL_QB_IMPACT;
        else if (use > 0 && m.use / use >= 0.15) {
          const add = Math.min(NFL_SKILL_IMPACT, Math.max(NFL_SKILL_CAP - skill, 0));
          skill += add;
          total += add;
        }
      }
    }
    impactCache.set(key, total);
    return total;
  };

  for (const key of STATS) {
    const stat = NFL_PROP_STAT_BY_KEY.get(key)!;
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let reducedErr = 0;
    let noLinesErr = 0;
    let naiveErr = 0;
    let withLines = 0;
    let withAbsences = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 4; i < games.length; i++) {
        const history = games.slice(0, i).reverse();
        const l5 = history.slice(0, 5).reduce((a, g) => a + stat.value(g), 0) / Math.min(history.length, 5);
        if (stat.shape !== "anytime" && l5 < (stat.shape === "yards" ? 15 : 1)) continue; // a line nobody hangs
        const line = stat.shape === "anytime" ? 0.5 : Math.round(l5 - 0.5) + 0.5;
        const game = games[i];
        const neutral = { defense: NEUTRAL, opponent: null, position: null };
        const lines = closing.get(game.gameId) ?? NO_LINES;
        const base = baselines.get(game.gameId);
        const absences = absencesFor(game.teamAbbr, game.date);
        const position = nflPositionGroup(game.position) ?? nflPositionGroup(inferNflPosition(history));
        const proj = projectNflProp(history, stat, {
          defense: defenseAsOf(game.date, game.season),
          opponent: game.opponent || null,
          position,
          absences,
          ownAbsenceImpact: impactTotalFor(game.teamAbbr, game.date),
          opponentAbsenceImpact: game.opponent ? impactTotalFor(game.opponent, game.date) : 0,
          lines,
          isHome: game.isHome,
          baselinePoints: (game.isHome ? base?.home : base?.away)?.scored ?? null,
          season: game.season,
        });
        const reduced = projectNflProp(history, stat, {
          ...neutral,
          lines,
          isHome: game.isHome,
          baselinePoints: (game.isHome ? base?.home : base?.away)?.scored ?? null,
          season: game.season,
        });
        const plain = projectNflProp(history, stat, neutral);
        if (!proj || !reduced || !plain) continue;
        const actual = stat.value(game);
        if (lines.total !== null) withLines++;
        if (absences.length > 0) withAbsences++;
        modelErr += Math.abs(proj.mean - actual);
        reducedErr += Math.abs(reduced.mean - actual);
        noLinesErr += Math.abs(plain.mean - actual);
        naiveErr += Math.abs(l5 - actual);
        n++;
        const p = nflProbOver(proj, stat, line);
        const overFav = p >= 0.5;
        samples.push({ pred: overFav ? p : 1 - p, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    samples.sort((a, b) => (a.date < b.date ? 1 : -1));
    console.log(
      `\n${stat.label}: LIVE projection MAE ${(modelErr / n).toFixed(3)} vs reduced ${(reducedErr / n).toFixed(3)}, without game lines ${(noLinesErr / n).toFixed(3)}, L5-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games (${withLines} with closing lines, ${withAbsences} with a key teammate out)`
    );
    const report = scoreCalibration(samples);
    console.log(formatCalibrationReport(`NFL ${stat.shortLabel} projection`, "player-game", report));
    await saveReport(`nfl-props:${key}`, `NFL props — ${stat.label}`, "player-game", report, {
      projectionMae: modelErr / n,
      reducedMae: reducedErr / n,
      baselineMae: naiveErr / n,
      baseline: "L5 average",
      noLinesMae: noLinesErr / n,
      gamesWithLines: withLines,
      gamesWithAbsences: withAbsences,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
