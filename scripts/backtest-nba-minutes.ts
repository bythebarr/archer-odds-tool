import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { MINUTES_PARAMS, projectNbaMinutes, type MinutesContext, type MinutesLog, type MinutesParams } from "@/lib/nba/minutes";
import { nbaEnvironment } from "@/lib/nba/environment";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import type { Absence } from "@/lib/injuries/absence";
import { closingGameLines } from "./props/history";

/**
 * Backtest and fit for the NBA minutes projection (lib/nba/minutes.ts). Every
 * logged game with at least five earlier games for that player is projected
 * from those earlier games only (no lookahead), with:
 *   - the teammates who sat that night standing in for the injury report: a
 *     rotation player (5+ of his team's previous 10 games, 18+ minutes a game)
 *     who didn't play;
 *   - his team's schedule (back-to-backs, the games he missed before it);
 *   - the closing spread (blowout minutes, environment.ts).
 * Each setting is fitted in turn (coordinate descent, two passes) on the older
 * 70% of games and scored on the newer 30%, against the current settings.
 * Prints the fitted settings to copy into MINUTES_PARAMS.
 *
 * Run: `npm run backtest:nba-minutes`.
 */
const ROTATION_MINUTES = 18;
const HISTORY = 120;

interface Sample {
  date: string;
  actual: number;
  history: MinutesLog[];
  ctx: MinutesContext;
  lines: GameLines;
  isHome: boolean;
  starter: boolean;
}

async function load(): Promise<Sample[]> {
  const rows = await prisma.nbaPlayerGameLog.findMany({
    orderBy: { gameDate: "asc" },
    select: { nbaPlayerId: true, gameId: true, gameDate: true, teamId: true, isHome: true, starter: true, minutes: true },
  });
  const closing = await closingGameLines("nba");
  type Row = { player: string; gameId: string; date: string; team: string; isHome: boolean; starter: boolean; minutes: number };
  const all: Row[] = rows.map((r) => ({ player: r.nbaPlayerId, gameId: r.gameId, date: etDateOf(r.gameDate), team: r.teamId, isHome: r.isHome, starter: r.starter, minutes: r.minutes }));
  console.log(`${all.length} player-game rows, ${closing.size} games with closing lines.`);

  const teamDates = new Map<string, string[]>();
  const teamGame = new Map<string, Row[]>(); // team|date → rows
  const byPlayer = new Map<string, Row[]>();
  for (const r of all) {
    const k = `${r.team}|${r.date}`;
    if (!teamGame.has(k)) {
      teamGame.set(k, []);
      (teamDates.get(r.team) ?? teamDates.set(r.team, []).get(r.team)!).push(r.date);
    }
    teamGame.get(k)!.push(r);
    (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)!).push(r);
  }
  for (const d of teamDates.values()) d.sort();

  /** Who sat that night: rotation players over the team's previous 10 games who didn't play. */
  const absencesFor = (team: string, date: string): Absence[] => {
    const dates = teamDates.get(team)!;
    const idx = dates.indexOf(date);
    const prev = dates.slice(Math.max(0, idx - 10), idx);
    const tonight = new Set(teamGame.get(`${team}|${date}`)!.filter((r) => r.minutes > 0).map((r) => r.player));
    const games = new Map<string, number[]>();
    for (const d of prev) for (const r of teamGame.get(`${team}|${d}`) ?? []) if (r.minutes > 0) (games.get(r.player) ?? games.set(r.player, []).get(r.player)!).push(r.minutes);
    const out: Absence[] = [];
    for (const [player, mins] of games) {
      if (tonight.has(player) || mins.length < 5) continue;
      const usage = mins.reduce((a, b) => a + b, 0) / mins.length;
      if (usage < ROTATION_MINUTES) continue;
      const playedDates = (byPlayer.get(player) ?? []).filter((r) => r.team === team && r.minutes > 0 && r.date < date).map((r) => r.date);
      out.push({ name: player, status: "out", playedDates, usage });
    }
    return out;
  };

  const samples: Sample[] = [];
  for (const games of byPlayer.values()) {
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (g.minutes <= 0) continue;
      const history = games
        .slice(Math.max(0, i - HISTORY), i)
        .reverse()
        .map((r) => ({ date: r.date, minutes: r.minutes, starter: r.starter, team: r.team }));
      if (history.filter((h) => h.minutes > 0).length < 5) continue;
      const yearAgo = new Date(Date.parse(`${g.date}T12:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
      samples.push({
        date: g.date,
        actual: g.minutes,
        history,
        ctx: { date: g.date, team: g.team, teamDates: teamDates.get(g.team)!.filter((d) => d < g.date && d >= yearAgo), absences: absencesFor(g.team, g.date) },
        lines: closing.get(g.gameId) ?? NO_LINES,
        isHome: g.isHome,
        starter: g.starter,
      });
    }
  }
  return samples;
}

function predict(s: Sample, p: MinutesParams): number {
  const m = projectNbaMinutes(s.history, s.ctx, p);
  if (!m) return 0;
  return m.minutes * nbaEnvironment(s.lines, s.isHome, "points", m.minutes, null).minutesFactor;
}

function score(samples: Sample[], p: MinutesParams) {
  let abs = 0;
  let sq = 0;
  let bias = 0;
  for (const s of samples) {
    const e = predict(s, p) - s.actual;
    abs += Math.abs(e);
    sq += e * e;
    bias += e;
  }
  const n = samples.length || 1;
  return { mae: abs / n, rmse: Math.sqrt(sq / n), bias: bias / n, n: samples.length };
}

const GRID: { [K in keyof MinutesParams]: number[] } = {
  window: [8, 10, 15, 20, 30],
  halfLife: [2, 3, 4, 5, 7, 10, 15],
  roleWeight: [1, 1.5, 2, 3, 5, 8],
  exitRatio: [0.35, 0.45, 0.55, 0.65],
  exitWeight: [1, 0.6, 0.35, 0.15, 0],
  absenceAlpha: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5],
  b2bStarter: [0.94, 0.96, 0.97, 0.98, 0.99, 1, 1.01],
  b2bBench: [0.94, 0.96, 0.98, 1, 1.02, 1.04],
  returnShort: [0.8, 0.85, 0.9, 0.93, 0.96, 1, 1.03],
  returnLong: [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
};

const fmt = (r: ReturnType<typeof score>) => `MAE ${r.mae.toFixed(3)}, RMSE ${r.rmse.toFixed(3)}, bias ${r.bias >= 0 ? "+" : ""}${r.bias.toFixed(2)} (n ${r.n})`;

async function main() {
  const samples = (await load()).sort((a, b) => a.date.localeCompare(b.date));
  const cut = samples[Math.floor(samples.length * 0.7)]?.date ?? "";
  const train = samples.filter((s) => s.date < cut);
  const test = samples.filter((s) => s.date >= cut);
  console.log(`${samples.length} player-games projected · train before ${cut}: ${train.length} · test: ${test.length}\n`);

  let fitted: MinutesParams = { ...MINUTES_PARAMS };
  for (let pass = 1; pass <= 2; pass++) {
    for (const key of Object.keys(GRID) as (keyof MinutesParams)[]) {
      let best = { v: fitted[key], mae: score(train, fitted).mae };
      for (const v of GRID[key]) {
        const mae = score(train, { ...fitted, [key]: v }).mae;
        if (mae < best.mae - 1e-4) best = { v, mae };
      }
      fitted = { ...fitted, [key]: best.v };
      console.log(`pass ${pass} · ${key} = ${best.v} (train MAE ${best.mae.toFixed(3)})`);
    }
  }

  const segments: [string, (s: Sample) => boolean][] = [
    ["all", () => true],
    ["started", (s) => s.starter],
    ["off the bench", (s) => !s.starter],
    ["back-to-back", (s) => (projectNbaMinutes(s.history, s.ctx)?.backToBack ?? false)],
    ["returning from a miss", (s) => (projectNbaMinutes(s.history, s.ctx)?.missed ?? 0) > 0],
    ["rotation teammates out", (s) => (s.ctx.absences?.length ?? 0) > 0],
    ["closing spread 10+", (s) => s.lines.homeSpread !== null && Math.abs(s.lines.homeSpread) >= 10],
  ];
  console.log(`\nTest (newest 30%), current settings vs fitted:`);
  for (const [label, f] of segments) {
    const sub = test.filter(f);
    if (!sub.length) continue;
    console.log(`  ${label.padEnd(24)} current ${fmt(score(sub, MINUTES_PARAMS))}`);
    console.log(`  ${"".padEnd(24)} fitted  ${fmt(score(sub, fitted))}`);
  }
  // The naive baseline people use: his last-10 average.
  const l10 = test.reduce((a, s) => {
    const p = s.history.filter((h) => h.minutes > 0).slice(0, 10);
    return a + Math.abs(p.reduce((x, h) => x + h.minutes, 0) / p.length - s.actual);
  }, 0);
  console.log(`  ${"(L10 average)".padEnd(24)} MAE ${(l10 / test.length).toFixed(3)}`);
  console.log(`\nFitted MINUTES_PARAMS:\n${JSON.stringify(fitted, null, 2)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
