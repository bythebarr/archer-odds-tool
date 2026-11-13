import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { MIN_GAIN, MIN_HALF, checkSide, type SideCheck, type SideSample, type SideStats } from "@/lib/audit/sideCalibration";
import { loadGradedLeans } from "@/lib/queries/edgeReport";

/**
 * Fit and check the side correction (lib/audit/sideCalibration) on every
 * settled NBA prop lean tracking froze before the game:
 *
 *   main lines, the blend    the chance the screener, builder and player
 *                            sheets show (features.rawProb)
 *   main lines, displayed    Hottest Tonight's calibrated chance (prob)
 *   alt rungs                the alt rung's chance (prob; no market)
 *
 * Each is fitted on the earlier half and judged on the later half. Read-only.
 * Run from the Model lab (script: fit:side-calibration).
 */
const pts = (x: number) => (Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`);
const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const row = (label: string, s: SideStats) =>
  `    ${label.padEnd(7)} n=${String(s.n).padStart(5)} · log loss ${s.logLoss.toFixed(4)} · Brier ${s.brier.toFixed(4)} · bias ${pts(s.bias)} pts (overs ${pts(s.overBias)}) · edge bets ${String(s.edgeBets).padStart(4)} ROI ${pct(s.roi)}`;

function print(label: string, c: SideCheck) {
  console.log(`\n═══ ${label} ═══`);
  console.log(`  fit on the earlier half: k=${c.fit.k} δ=${c.fit.delta}   (fit on all: k=${c.full.k} δ=${c.full.delta})`);
  console.log("  later half:");
  console.log(row("today", c.before));
  console.log(row("fixed", c.after));
  console.log(`  VERDICT: ${c.verdict === "improves" ? "IMPROVES — ship the all-data fit" : c.verdict === "too few" ? `TOO FEW (${MIN_HALF}+ a half)` : `NO BETTER (needs ${MIN_GAIN} lower log loss and no worse Brier)`}`);
}

async function main() {
  const leans = (await loadGradedLeans(365)).filter((l) => l.features.sport === "nba" && l.features.kind === "prop" && (l.result === "hit" || l.result === "miss") && (l.features.side === "over" || l.features.side === "under"));
  const date = (l: (typeof leans)[number]) => l.startsAt.toISOString().slice(0, 10);
  const toSample = (l: (typeof leans)[number], pSide: number): SideSample => {
    const over = l.features.side === "over";
    const won = l.result === "hit" ? 1 : 0;
    return {
      pOver: over ? pSide : 1 - pSide,
      mOver: l.features.marketProb === null ? null : over ? l.features.marketProb : 1 - l.features.marketProb,
      side: over ? "over" : "under",
      price: l.features.price,
      overHit: (over ? won : 1 - won) as 0 | 1,
      date: date(l),
    };
  };
  const mains = leans.filter((l) => !l.features.alt);
  const alts = leans.filter((l) => l.features.alt);
  console.log(`NBA prop leans settled: ${leans.length} (${mains.length} main lines, ${alts.length} alt rungs)`);
  const blend = mains.filter((l) => typeof l.features.rawProb === "number");
  print("Main lines · the blend (screener, builder, player sheets)", checkSide(blend.map((l) => toSample(l, l.features.rawProb!))));
  print("Main lines · Hottest Tonight's displayed chance", checkSide(mains.map((l) => toSample(l, l.prob))));
  print("Alt rungs · displayed chance (no market: anchored at even)", checkSide(alts.map((l) => toSample(l, l.prob))));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
