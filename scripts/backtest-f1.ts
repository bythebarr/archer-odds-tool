import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadF1Races } from "@/lib/f1/raceData";
import { DEFAULT_F1_OPTS, F1Ratings, simulateRace, type F1ModelOpts, type F1RaceRecord } from "@/lib/f1/raceModel";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { etDateOf } from "@/lib/dateEt";

/**
 * Backtest for the F1 race model (src/lib/f1/raceModel.ts). Replays every race
 * in date order, predicting each from earlier races only (the entry list is
 * known before the start), and:
 *   - grid-searches the car / driver learning rates and season reversion on the
 *     winner's log loss (closed-form Plackett–Luce win chance, reliability
 *     included), against a uniform pick and a points-so-far baseline
 *   - simulates the newest races with the chosen settings and grades the
 *     podium probabilities (calibration report, saved as f1-races:podium with
 *     the settings the live model reads back)
 *
 * Run: `npm run backtest:f1` (FROM=2010 sets the first scored season).
 */
const WARMUP_RACES = 20;

function winProbs(r: F1Ratings, race: F1RaceRecord): number[] {
  const w = race.entries.map((e) => Math.exp(r.pace(e)) * (1 - r.mechanicalRate(e.constructorId)) * (1 - r.incidentRate(e.driverId)));
  const z = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / z);
}

function winnerLogLoss(races: F1RaceRecord[], opts: F1ModelOpts, from: number): { model: number; uniform: number; points: number; n: number } {
  const r = new F1Ratings(opts);
  const seasonPoints = new Map<string, number>();
  let model = 0;
  let uniform = 0;
  let pts = 0;
  let n = 0;
  races.forEach((race, i) => {
    r.touch(race.entries, race.season);
    const winner = race.entries.findIndex((e) => e.position === 1);
    if (i >= WARMUP_RACES && race.season >= from && winner >= 0) {
      model -= Math.log(Math.max(winProbs(r, race)[winner], 1e-9));
      uniform += Math.log(race.entries.length);
      const w = race.entries.map((e) => (seasonPoints.get(`${race.season}|${e.driverId}`) ?? 0) + 1);
      pts -= Math.log(w[winner] / w.reduce((a, b) => a + b, 0));
      n++;
    }
    r.update(race);
    const award = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    for (const e of race.entries) {
      const k = `${race.season}|${e.driverId}`;
      seasonPoints.set(k, (seasonPoints.get(k) ?? 0) + (e.position && e.position <= 10 ? award[e.position - 1] : 0));
    }
  });
  return { model: model / n, uniform: uniform / n, points: pts / n, n };
}

async function main() {
  const races = await loadF1Races();
  const from = Number(process.env.FROM ?? 2010);
  console.log(`${races.length} races with results; scoring seasons ${from}+.`);
  if (races.length < WARMUP_RACES + 10) {
    console.log("Too few races to backtest.");
    return;
  }

  let best = { opts: DEFAULT_F1_OPTS, ll: Infinity };
  for (const carRate of [0.06, 0.12, 0.2, 0.3])
    for (const driverRate of [0.02, 0.05, 0.1])
      for (const carRevert of [0.3, 0.5, 0.7]) {
        const opts = { ...DEFAULT_F1_OPTS, carRate, driverRate, carRevert };
        const res = winnerLogLoss(races, opts, from);
        if (res.model < best.ll) best = { opts, ll: res.model };
      }
  const res = winnerLogLoss(races, best.opts, from);
  console.log(`Best: car ${best.opts.carRate}, driver ${best.opts.driverRate}, car revert ${best.opts.carRevert}`);
  console.log(`Winner log loss over ${res.n} races: model ${res.model.toFixed(3)}, points-so-far ${res.points.toFixed(3)}, uniform ${res.uniform.toFixed(3)}`);

  // Simulate the newest races for podium calibration.
  const r = new F1Ratings(best.opts);
  const samples: (CalibrationSample & { date: string })[] = [];
  const simulateFrom = Math.max(WARMUP_RACES, races.length - 150);
  races.forEach((race, i) => {
    r.touch(race.entries, race.season);
    if (i >= simulateFrom) {
      const odds = simulateRace(r, race.entries, 4000, i);
      for (const o of odds) {
        const e = race.entries.find((x) => x.driverId === o.driverId)!;
        const hit = e.position !== null && e.position <= 3;
        const fav = o.podium >= 0.5;
        samples.push({ pred: fav ? o.podium : 1 - o.podium, won: (hit === fav ? 1 : 0) as 0 | 1, date: etDateOf(race.date) });
      }
    }
    r.update(race);
  });
  samples.sort((a, b) => (a.date < b.date ? 1 : -1));
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("F1 podium probabilities", "driver-race", report));
  await saveReport("f1-races:podium", "F1 — podium chances", "driver-race", report, {
    opts: best.opts,
    winLogLoss: res.model,
    pointsShareLogLoss: res.points,
    uniformLogLoss: res.uniform,
    projectionMae: null,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
