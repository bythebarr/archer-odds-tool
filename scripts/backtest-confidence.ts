import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { MIN_EDGE_BETS, MIN_POOLED, validateConfidence, validateGraded, type ConfidenceValidation, type GradeStats } from "@/lib/propModel/confidenceGrade";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { closingGameLines, teamBaselinesByGame } from "./props/history";
import { gradedNbaSides } from "./props/nbaGradedSides";

/**
 * Grade the Confidence grade (lib/propModel/confidence): on every graded NBA
 * prop side with stored closing quotes (the same reconstruction as
 * backtest:cautious-edge, prior games only), grade each side as the site
 * would, then ask whether higher grades are where ARCHR's read held up —
 * more accurate (Brier) and its positive-edge bets more profitable at the
 * closing price (lib/propModel/confidenceGrade).
 *
 * Factors the history can't reconstruct are left neutral and said so: the
 * blend report card's verdict at the time, injury tags, and alt rungs (only
 * consensus main lines are graded). Read-only. Run from the Model lab
 * (script: backtest:confidence). Without DB access, or with too few samples,
 * it prints "VERDICT: DATA REQUIRED" and exits non-zero.
 */
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (g: GradeStats) =>
  `  ${g.label.padEnd(4)} n=${String(g.n).padStart(5)} · ARCHR ${pct(g.meanArchr)} vs hit ${pct(g.hitRate)} · Brier ${g.brier.toFixed(4)} · edge bets ${String(g.edgeBets).padStart(4)}, ROI ${pct(g.edgeRoi)} [${pct(g.edgeRoiLow)}, ${pct(g.edgeRoiHigh)}]`;

function report(v: ConfidenceValidation): boolean {
  console.log("By grade:");
  for (const g of v.grades) console.log(line(g));
  console.log("\nPooled:");
  console.log(line(v.high));
  console.log(line(v.low));
  if (v.verdict === "data-required") {
    console.log(`\nVERDICT: DATA REQUIRED — ${v.reason} (needs ${MIN_POOLED}+ sides and ${MIN_EDGE_BETS}+ edge bets on each side of the split)`);
    return false;
  }
  console.log(`\nVERDICT: ${v.verdict === "validated" ? "VALIDATED" : "NOT VALIDATED"} — ${v.reason}`);
  return v.verdict === "validated";
}

/**
 * The live check: every settled tracked prop lean that froze the grade the
 * product showed (capture.ts, from 2026-11-12). Out of sample by
 * construction — the weights were set before any of these games were played.
 */
async function live() {
  const leans = (await loadGradedLeans(365)).filter((l) => (l.result === "hit" || l.result === "miss") && l.features.confidence);
  console.log(`\n\n═══ LIVE: tracked prop leans with the grade frozen before the game — ${leans.length} settled ═══`);
  if (!leans.length) {
    console.log("None settled yet: grades freeze with every lean captured from 2026-11-12 on.");
    return;
  }
  for (const sport of ["nba", "nfl", "all"] as const) {
    const rows = leans.filter((l) => sport === "all" || l.features.sport === sport);
    if (!rows.length) continue;
    console.log(`\n── ${sport.toUpperCase()} (${rows.length}) ──`);
    report(validateGraded(rows.map((l) => ({ archr: l.prob, priceAmerican: l.features.price, won: l.result === "hit" ? 1 : 0, grade: l.features.confidence!.grade }))));
  }
}

async function main() {
  let sides;
  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
    sides = await gradedNbaSides(closing, baselines);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.log(`\nVERDICT: DATA REQUIRED — the database could not be read from here (run from the Model lab, script backtest:confidence)`);
    process.exitCode = 1;
    return;
  }
  const v = validateConfidence(sides.map((s) => ({ archr: s.pBlend, marketChance: s.marketChance, priceAmerican: s.priceAmerican, rate: s.rate, sampleGames: s.sampleGames, minutes: s.minutes, z: s.z, side: s.side, sport: "nba", won: s.won })));
  console.log(`\nNBA props, both sides of each closing consensus line: ${v.n} graded sides`);
  console.log("Not reconstructable, left neutral: report-card verdict at the time, injury tags, alt rungs.\n");
  const ok = report(v);
  await live().catch((e) => console.log(`\n(live check skipped: ${e instanceof Error ? e.message : e})`));
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
