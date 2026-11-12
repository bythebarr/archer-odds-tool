import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { MIN_EDGE_BETS, MIN_POOLED, validateConfidence, type GradeStats } from "@/lib/propModel/confidenceGrade";
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
  console.log("By grade:");
  for (const g of v.grades) console.log(line(g));
  console.log("\nPooled:");
  console.log(line(v.high));
  console.log(line(v.low));
  if (v.verdict === "data-required") {
    console.log(`\nVERDICT: DATA REQUIRED — ${v.reason} (needs ${MIN_POOLED}+ sides and ${MIN_EDGE_BETS}+ edge bets on each side of the split)`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nVERDICT: ${v.verdict === "validated" ? "VALIDATED" : "NOT VALIDATED"} — ${v.reason}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
