import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  MIN_GATE_SAMPLES,
  cautiousVerdict,
  evidenceGate,
  gradeCautiousSamples,
  type CautiousBucket,
  type CautiousGradeSample,
  type ProbScore,
} from "@/lib/propModel/cautiousGrade";
import { EVIDENCE_PRIOR_GAMES } from "@/lib/propModel/cautiousRead";
import { CAUTIOUS_READ_MODE } from "@/lib/propModel/canonical";
import { closingGameLines, teamBaselinesByGame } from "./props/history";
import { gradedNbaSides, type GradedSide } from "./props/nbaGradedSides";

/**
 * Grade the haircut (One Number, Step 2): on every graded NBA prop with
 * stored snapshots — the same collection as backtest:props-market —
 * reconstruct, from prior games only, BOTH sides of the consensus line:
 *
 *   - ARCHR Chance: the blend (calibrated model + de-vigged closing
 *     consensus) at DEFAULT_MODEL_WEIGHT — the weight every NBA stat
 *     actually prices at today, since all sit below MIN_FIT_SAMPLES.
 *   - LEGACY cautious read: min(ARCHR Chance, Wilson floor of the player's
 *     L10 record at the line).
 *   - EVIDENCE cautious read: the L10 record as a Beta update on ARCHR
 *     Chance, each game weighted by how closely its minutes and role match
 *     that night's PROJECTED minutes and role (projectNbaMinutes on prior
 *     games only — never the minutes he actually played, which would leak).
 *
 * Then score all three against the result (log loss, Brier, mean predicted
 * vs actual), bucket by each cautious read's edge vs the best CLOSING price
 * (hit rate vs the price's implied chance = beat the close; flat-stake ROI),
 * and run the evidence gate (lib/propModel/cautiousGrade evidenceGate) that
 * decides whether canonical's CAUTIOUS_READ_MODE may flip to "evidence".
 * Pure scoring lives in lib/propModel/cautiousGrade (unit-tested on
 * synthetic fixtures); this script is the DB collection + print.
 *
 * Known reconstruction limits, same family as backtest:props-market: no
 * injury adjustment and no posted lineups (neither stored historically).
 *
 * Needs the production DATABASE_URL: run it from the Model lab workflow
 * (script: backtest:cautious-edge). Read-only. Without DB access, or with too
 * few graded props, it prints "VERDICT: DATA REQUIRED" with what it needs and
 * exits non-zero — never a fabricated or green result.
 * NFL collection is the follow-on (same shape as gradedNfl there).
 */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const scoreLine = (name: string, s: ProbScore) =>
  `  ${name.padEnd(15)} log loss ${s.logLoss.toFixed(4)} · Brier ${s.brier.toFixed(4)} · mean predicted ${pct(s.meanProb)} vs actual ${pct(s.hitRate)}`;
const bucketLine = (b: CautiousBucket) =>
  `    ${b.label.padEnd(24)} n=${String(b.n).padStart(5)} · hit ${pct(b.hitRate)} vs closing implied ${pct(b.meanImplied)} · ROI ${pct(b.roi)} [${pct(b.roiLow)}, ${pct(b.roiHigh)}] · blend LL ${b.blendLogLoss.toFixed(4)} · read LL ${b.readLogLoss.toFixed(4)}`;

function printGrade(label: string, samples: CautiousGradeSample[], full: boolean) {
  const g = gradeCautiousSamples(samples);
  console.log(`\n${label}: ${g.n} graded sides (${g.pricedN} priced at the close, ${g.roleWeightedN} with role weighting)`);
  if (!g.n) return g;
  console.log(scoreLine("blend", g.blend));
  console.log(scoreLine("legacy min()", g.legacy));
  console.log(scoreLine("evidence", g.evidence));
  console.log(scoreLine("evidence plain", g.evidencePlain));
  console.log(`  min() vs blend — ${cautiousVerdict(g)}`);
  if (!full) return g;
  for (const [mode, name] of [["legacy-min", "legacy min()"], ["evidence", "evidence"]] as const) {
    console.log(`  buckets by the ${name} cautious edge (closing prices):`);
    for (const b of g.buckets[mode]) if (b.n) console.log(bucketLine(b));
  }
  console.log(`  prior-strength sweep (diagnostic only; shipped K = ${EVIDENCE_PRIOR_GAMES}, never refit automatically):`);
  for (const p of g.priorSweep) console.log(`    K=${String(p.priorGames).padStart(2)} log loss ${p.logLoss.toFixed(4)} · Brier ${p.brier.toFixed(4)}`);
  return g;
}

function dataRequired(why: string) {
  console.log(`\nVERDICT: DATA REQUIRED — ${why}`);
  console.log(`  Needs: the production DATABASE_URL (run via the Model lab workflow, script backtest:cautious-edge) and at least`);
  console.log(`  ${MIN_GATE_SAMPLES} graded NBA prop sides: final games with stored NbaPropSnapshot closing quotes (two-sided, to de-vig),`);
  console.log(`  NbaPlayerGameLog box scores (minutes and starter) for every player before and on that night.`);
  console.log(`  Until then canonical CAUTIOUS_READ_MODE stays "${CAUTIOUS_READ_MODE}" (legacy min()): no numbers change.`);
  process.exitCode = 1;
}

async function main() {
  let graded: GradedSide[];
  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
    graded = await gradedNbaSides(closing, baselines);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    dataRequired("the database could not be read from here");
    return;
  }
  const g = printGrade("NBA — all stats, both sides", graded, true);
  printGrade("NBA — overs", graded.filter((x) => x.side === "over"), false);
  printGrade("NBA — unders", graded.filter((x) => x.side === "under"), false);
  for (const stat of [...new Set(graded.map((x) => x.stat))]) printGrade(`NBA — ${stat}`, graded.filter((x) => x.stat === stat), false);

  const gate = evidenceGate(g);
  if (gate.decision === "data-required") return dataRequired(gate.reason);
  console.log(`\nVERDICT: ${gate.decision === "adopt-evidence" ? "ADOPT EVIDENCE READ" : "KEEP LEGACY min()"} — ${gate.reason}`);
  const top = g.buckets.evidence.filter((b) => (b.key === "10-20" || b.key === "20+") && b.n);
  for (const b of top) {
    const beat = b.hitRate > b.meanImplied ? "beat" : "did not beat";
    console.log(`  evidence ${b.label}: ${beat} the closing price (hit ${pct(b.hitRate)} vs ${pct(b.meanImplied)}), ROI ${pct(b.roi)} [${pct(b.roiLow)}, ${pct(b.roiHigh)}] on ${b.n}`);
  }
  if (gate.decision === "adopt-evidence") console.log(`  To ship: set CAUTIOUS_READ_MODE = "evidence" in src/lib/propModel/canonical.ts (a reviewed one-line change).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
