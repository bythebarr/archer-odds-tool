/**
 * Soccer player props backtest: every player a team would have listed before
 * each of the last DAYS days' matches (expected minutes from his team's earlier
 * matches), predicted only from what came before, scored against what he did.
 *
 *   npx tsx scripts/backtest-soccer-props.ts [days=45] [priorMinutes] [halfLife]
 *
 * Anytime props: log loss against the position's base rate, and calibration by
 * decile. Counts: how often Over hit at ARCHR's line (≈50% if the line is
 * placed well) and log loss of the Over call.
 */
import { prisma } from "@/lib/prisma";
import { seasonOf } from "@/lib/allSports/model/ratings";
import {
  DEFAULT_OPTS,
  MIN_EXPECTED_MINUTES,
  SOCCER_PROP_STATS,
  projectSoccerProp,
  projectionOver,
  soccerLine,
  type ModelOpts,
  type Position,
  type SoccerLog,
} from "@/lib/soccer/propModel";
import { teamShotTotals, shotContext } from "@/lib/soccer/shotContext";

const DAYS = Number(process.argv[2] ?? 45);
const OPTS: ModelOpts = {
  playPrior: Number(process.argv[6] ?? DEFAULT_OPTS.playPrior),
  priorMinutes: Number(process.argv[3] ?? DEFAULT_OPTS.priorMinutes),
  halfLife: Number(process.argv[4] ?? DEFAULT_OPTS.halfLife),
  damp: Number(process.argv[5] ?? DEFAULT_OPTS.damp),
};

async function main() {
  const rows = await prisma.soccerPlayerMatch.findMany({
    select: { playerId: true, date: true, team: true, opponent: true, isHome: true, starter: true, minutes: true, goals: true, assists: true, shots: true, shotsOnTarget: true, saves: true, yellowCards: true, redCards: true, fouls: true, player: { select: { position: true } } },
    orderBy: { date: "desc" },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const byPlayer = new Map<string, SoccerLog[]>();
  const position = new Map<string, Position>();
  const teamDates = new Map<string, string[]>();
  const teamRosterByDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const log: SoccerLog = { date: day(r.date), opponent: r.opponent, isHome: r.isHome, season: seasonOf(r.date), team: r.team, starter: r.starter, minutes: r.minutes, goals: r.goals, assists: r.assists, shots: r.shots, shotsOnTarget: r.shotsOnTarget, saves: r.saves, yellowCards: r.yellowCards, redCards: r.redCards, fouls: r.fouls };
    (byPlayer.get(r.playerId) ?? byPlayer.set(r.playerId, []).get(r.playerId)!).push(log);
    position.set(r.playerId, (r.player.position as Position | null) ?? position.get(r.playerId) ?? "M");
    const td = teamDates.get(r.team) ?? teamDates.set(r.team, []).get(r.team)!;
    if (td[td.length - 1] !== log.date) td.push(log.date);
    const key = `${r.team}|${log.date}`;
    (teamRosterByDate.get(key) ?? teamRosterByDate.set(key, new Set()).get(key)!).add(r.playerId);
  }
  const shots = teamShotTotals(rows.map((r) => ({ team: r.team, opponent: r.opponent, date: day(r.date), isHome: r.isHome, shots: r.shots, shotsOnTarget: r.shotsOnTarget })));
  const cutoff = day(new Date(Date.now() - DAYS * 86_400_000));
  const acc = new Map<string, { n: number; ll: number; base: number; hits: number; sumP: number; bins: { p: number; y: number }[] }>();
  const baseRate = new Map<string, number>();

  for (const [team, dates] of teamDates) {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;
      if (date < cutoff) break;
      const before = dates.slice(i + 1);
      if (before.length < 3) continue;
      const tonight = shots.matches.get(`${team}|${date}`);
      if (!tonight) continue;
      const ctx = shotContext(shots, tonight.opponent, date, tonight.isHome);
      // Everyone who played for the team in its previous six matches is a candidate.
      const candidates = new Set<string>();
      for (const d of before.slice(0, 6)) for (const p of teamRosterByDate.get(`${team}|${d}`) ?? []) candidates.add(p);
      for (const pid of candidates) {
        const all = byPlayer.get(pid)!;
        const past = all.filter((l) => l.date < date);
        const actual = all.find((l) => l.date === date && l.team === team);
        const pos = position.get(pid)!;
        for (const stat of SOCCER_PROP_STATS) {
          if (!stat.positions.includes(pos)) continue;
          const proj = projectSoccerProp(past, before, stat, pos, ctx, OPTS);
          if (proj.expected < MIN_EXPECTED_MINUTES) continue;
          const point = soccerLine(stat, proj);
          const p = projectionOver(proj, point, stat);
          const y = actual ? (stat.value(actual) > point ? 1 : 0) : 0;
          const k = `${stat.key}${stat.shape === "anytime" ? "" : ""}|${pos}`;
          const a = acc.get(k) ?? { n: 0, ll: 0, base: 0, hits: 0, sumP: 0, bins: [] };
          a.n++;
          a.ll -= y ? Math.log(p) : Math.log(1 - p);
          a.hits += y;
          a.sumP += p;
          a.bins.push({ p, y });
          acc.set(k, a);
        }
      }
    }
  }
  console.log(`opts ${JSON.stringify(OPTS)}`);
  // Base rate: each (stat, position)'s own hit rate, as a constant forecast.
  console.log("stat|pos            n     hit%   model%   LL     baseLL   calib (pred→actual by quintile)");
  for (const [k, a] of [...acc].sort()) {
    const r = a.hits / a.n;
    baseRate.set(k, r);
    const baseLL = -(r * Math.log(r) + (1 - r) * Math.log(1 - r));
    const sorted = [...a.bins].sort((x, y) => x.p - y.p);
    const q = 5;
    const calib = Array.from({ length: q }, (_, i) => {
      const s = sorted.slice(Math.floor((i * sorted.length) / q), Math.floor(((i + 1) * sorted.length) / q));
      const mp = s.reduce((t, x) => t + x.p, 0) / s.length;
      const my = s.reduce((t, x) => t + x.y, 0) / s.length;
      return `${(mp * 100).toFixed(0)}→${(my * 100).toFixed(0)}`;
    }).join(" ");
    console.log(`${k.padEnd(18)} ${String(a.n).padStart(6)} ${(r * 100).toFixed(1).padStart(6)} ${((a.sumP / a.n) * 100).toFixed(1).padStart(7)} ${(a.ll / a.n).toFixed(4)} ${baseLL.toFixed(4)}  ${calib}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
