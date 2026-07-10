import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getUfcMatchupAsOf } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";

/**
 * Lookahead-safe calibration backtest for the UFC fighter-math model. For each
 * historical completed bout it rebuilds the projection using ONLY fight history
 * that existed before that bout (getUfcMatchupAsOf), then measures how well the
 * model's favorite probability matches the actual favorite win rate.
 *
 * Two outputs:
 *   1. The current model's calibration (with CALIBRATION_SHRINK already baked
 *      into computeUfcWinProbability) — the number to watch over time.
 *   2. The best logit-shrink re-fit on an older-fights TRAIN split and scored on
 *      a held-out newer TEST split — so as the sample grows you can tell whether
 *      the baked shrink still holds or should be retuned.
 *
 * Run: `npm run backtest:ufc` (optionally `N=1200 npm run backtest:ufc`).
 * This model has only a thin per-fight edge (Brier ~0.24 vs 0.25 coin-flip);
 * calibration keeps it HONEST, it does not manufacture edge. See fighterMath.ts.
 */

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

interface Row {
  pred: number; // model's favorite probability
  won: number; // 1 if the model's favorite actually won
}

async function collect(sample: number): Promise<Row[]> {
  const bouts = await prisma.ufcBout.findMany({
    where: { status: "completed", winnerFighterId: { not: null }, event: { hasStats: true } },
    select: {
      redCornerFighterId: true,
      blueCornerFighterId: true,
      winnerFighterId: true,
      event: { select: { eventDate: true } },
    },
    orderBy: { event: { eventDate: "desc" } }, // newest first (for the time split)
    take: sample,
  });

  const rows: Row[] = [];
  for (const b of bouts) {
    const matchup = await getUfcMatchupAsOf(b.redCornerFighterId, b.blueCornerFighterId, b.event.eventDate);
    if (!matchup) continue;
    const proj = computeUfcWinProbability(matchup, b.event.eventDate);
    if (proj.fighterAProb === null || proj.fighterBProb === null) continue;
    const redFav = proj.fighterAProb >= proj.fighterBProb;
    rows.push({
      pred: redFav ? proj.fighterAProb : proj.fighterBProb,
      won: b.winnerFighterId === (redFav ? b.redCornerFighterId : b.blueCornerFighterId) ? 1 : 0,
    });
  }
  return rows;
}

function brier(rows: Row[], shrink = 1): number {
  return rows.reduce((s, r) => s + (logistic(shrink * logit(r.pred)) - r.won) ** 2, 0) / rows.length;
}

function report(rows: Row[]): void {
  const n = rows.length;
  const meanPred = (rows.reduce((s, r) => s + r.pred, 0) / n) * 100;
  const actual = (rows.reduce((s, r) => s + r.won, 0) / n) * 100;
  console.log(`\n=== current model calibration (${n} priceable bouts) ===`);
  console.log(`mean predicted favorite: ${meanPred.toFixed(1)}%   actual favorite win rate: ${actual.toFixed(1)}%   gap ${(actual - meanPred >= 0 ? "+" : "")}${(actual - meanPred).toFixed(1)}pt`);
  console.log(`Brier ${brier(rows).toFixed(4)}  (0.25 = coin flip; lower is better)`);
  console.log(`\nbucket      n     predicted  actual   gap`);
  const edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8001];
  for (let i = 0; i < edges.length - 1; i++) {
    const bk = rows.filter((r) => r.pred >= edges[i] && r.pred < edges[i + 1]);
    if (!bk.length) continue;
    const p = (bk.reduce((s, r) => s + r.pred, 0) / bk.length) * 100;
    const a = (bk.reduce((s, r) => s + r.won, 0) / bk.length) * 100;
    console.log(`${(edges[i] * 100).toFixed(0)}-${(edges[i + 1] * 100).toFixed(0)}%  ${String(bk.length).padStart(4)}     ${p.toFixed(1)}%    ${a.toFixed(1)}%   ${(a - p >= 0 ? "+" : "")}${(a - p).toFixed(1)}pt`);
  }
}

function refit(rows: Row[]): void {
  // Time split: rows are newest-first, so train on the OLDER 60%, test on newer 40%.
  const testN = Math.floor(rows.length * 0.4);
  const test = rows.slice(0, testN);
  const train = rows.slice(testN);

  let best = 1;
  let bestB = Infinity;
  for (let s = 0.05; s <= 1.5001; s += 0.05) {
    const b = brier(train, s);
    if (b < bestB) {
      bestB = b;
      best = s;
    }
  }
  // NOTE: computeUfcWinProbability already applies the currently-baked shrink,
  // so this ADDITIONAL best shrink should sit near 1.0 if the baked value is
  // still right; a value far from 1.0 means it's time to retune CALIBRATION_SHRINK.
  console.log(`\n=== re-fit check (train ${train.length} / test ${test.length}) ===`);
  console.log(`best ADDITIONAL logit-shrink on the already-calibrated model: ${best.toFixed(2)} (near 1.00 = baked value still good)`);
  console.log(`test Brier — as-is ${brier(test).toFixed(4)}  vs  extra-shrunk ${brier(test, best).toFixed(4)}`);
}

async function main() {
  const sample = Number(process.env.N ?? 900);
  console.log(`Backtesting UFC fighter-math calibration over up to ${sample} recent completed bouts…`);
  const rows = await collect(sample);
  report(rows);
  refit(rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
