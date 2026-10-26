import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getUfcMatchupAsOf, type UfcMatchup } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { DEFAULT_PRIOR, type PriorParams } from "@/lib/ufc/fighterStrength";

/**
 * Fits the pro-record prior (fighterStrength.ts) to history. Every settled bout
 * where either fighter had fewer than 4 UFC fights going in is rebuilt as-of
 * fight day (no lookahead), then a grid of `scale` × `debutDiscount` is scored
 * by log loss on red's win. Prints the best pair next to the shipped defaults,
 * plus the raw debut win rate, so the constants can be updated from evidence.
 *
 * Run: `npm run fit:ufc-prior` (optionally `N=1500 npm run fit:ufc-prior`).
 */
const SCALES = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
const DISCOUNTS = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08];

function logLoss(samples: { m: UfcMatchup; date: Date; redWon: boolean }[], params: PriorParams) {
  let loss = 0;
  let n = 0;
  let brier = 0;
  for (const s of samples) {
    const p = computeUfcWinProbability(s.m, s.date, params).fighterAProb;
    if (p === null) continue;
    const y = s.redWon ? 1 : 0;
    loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    brier += (p - y) ** 2;
    n++;
  }
  return { n, logLoss: loss / n, brier: brier / n };
}

async function main() {
  const limit = Number(process.env.N ?? 1200);
  const bouts = await prisma.ufcBout.findMany({
    where: { status: "completed", winnerFighterId: { not: null }, event: { hasStats: true } },
    select: { redCornerFighterId: true, blueCornerFighterId: true, winnerFighterId: true, event: { select: { eventDate: true } } },
    orderBy: { event: { eventDate: "desc" } },
    take: limit,
  });

  const samples: { m: UfcMatchup; date: Date; redWon: boolean }[] = [];
  let debuts = 0;
  let debutWins = 0;
  for (const b of bouts) {
    const m = await getUfcMatchupAsOf(b.redCornerFighterId, b.blueCornerFighterId, b.event.eventDate);
    if (!m || Math.min(m.fighterA.fights.length, m.fighterB.fights.length) >= 4) continue;
    samples.push({ m, date: b.event.eventDate, redWon: b.winnerFighterId === b.redCornerFighterId });
    // Debut vs an established (4+) UFC fighter: how often does the debutant win?
    for (const [me, them, id] of [[m.fighterA, m.fighterB, b.redCornerFighterId], [m.fighterB, m.fighterA, b.blueCornerFighterId]] as const) {
      if (me.fights.length === 0 && them.fights.length >= 4) {
        debuts++;
        if (b.winnerFighterId === id) debutWins++;
      }
    }
  }

  console.log(`${samples.length} bouts with a short-UFC-history fighter (of ${bouts.length} scanned).`);
  console.log(`Debutant vs established: ${debutWins}/${debuts} won (${debuts ? ((100 * debutWins) / debuts).toFixed(1) : "—"}%).`);
  const base = logLoss(samples, DEFAULT_PRIOR);
  console.log(`Shipped defaults ${JSON.stringify(DEFAULT_PRIOR)}: n=${base.n} logLoss=${base.logLoss.toFixed(4)} brier=${base.brier.toFixed(4)}`);

  let best = { params: DEFAULT_PRIOR, ...base };
  for (const scale of SCALES) {
    for (const debutDiscount of DISCOUNTS) {
      const params = { ...DEFAULT_PRIOR, scale, debutDiscount };
      const r = logLoss(samples, params);
      if (r.n === base.n && r.logLoss < best.logLoss) best = { params, ...r };
    }
  }
  console.log(`Best fit ${JSON.stringify(best.params)}: logLoss=${best.logLoss.toFixed(4)} brier=${best.brier.toFixed(4)}`);
  console.log("Coin flip logLoss = 0.6931. Update DEFAULT_PRIOR only when the gain holds on a rerun with a different N.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
