import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { MIN_EDGE_BETS, MIN_POOLED, validateConfidence, validateGraded, type ConfidenceValidation, type GradeStats } from "@/lib/propModel/confidenceGrade";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { getReportedBlendVerdicts, getReportedGraded } from "@/lib/queries/modelTrust";
import { nbaScreener, nflScreener } from "@/lib/screener/sources";
import { poolConfidenceInput, recordOf } from "@/lib/pools/confidence";
import { blendVerdictsByStat } from "@/lib/props/provenance";
import { confidenceOf, gradeOf } from "@/lib/propModel/confidence";
import { CUTS_LINE, biggestCost, ceiling, factorSummary, gradeCounts, gradesChangedWithout, maxPossible, outcomeTables, scoreHistogram, type BucketStats } from "@/lib/propModel/confidenceDiagnosis";
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

const roi = (x: number | null) => (x === null ? "—" : pct(x));
const bline = (b: BucketStats) =>
  `  ${b.label.padEnd(6)} n=${String(b.n).padStart(5)} · ARCHR ${b.n ? pct(b.meanArchr) : "—"} vs hit ${b.n ? pct(b.hitRate) : "—"} · Brier ${b.n ? b.brier.toFixed(4) : "—"} · edge bets ${String(b.edgeBets).padStart(4)}, ROI ${roi(b.edgeRoi)}`;

/** Settled leans that froze a grade on or after this date (capture started recording it 2026-11-12). */
const FROZEN_SINCE = "2026-11-12";

/** Every settled lean's frozen grade and score since FROZEN_SINCE, by sport, and outcomes by grade and score bucket. */
async function frozen() {
  const leans = (await loadGradedLeans(30)).filter((l) => (l.result === "hit" || l.result === "miss") && l.features.confidence && l.startsAt.toISOString().slice(0, 10) >= FROZEN_SINCE);
  console.log(`\n\n═══ FROZEN GRADES: settled leans since ${FROZEN_SINCE} — ${leans.length} ═══`);
  for (const sport of ["nba", "nfl"] as const) {
    for (const alt of [false, true]) {
      const rows = leans.filter((l) => l.features.sport === sport && Boolean(l.features.alt) === alt);
      if (!rows.length) continue;
      const counts = { A: 0, B: 0, C: 0, D: 0 };
      for (const l of rows) counts[l.features.confidence!.grade]++;
      console.log(`  ${sport.toUpperCase()} ${alt ? "alt rungs " : "main lines"}  n=${rows.length} · A ${counts.A} · B ${counts.B} · C ${counts.C} · D ${counts.D} · scores: ${scoreHistogram(rows.map((l) => l.features.confidence!.score)).map((b) => `${b.bucket}:${b.n}`).join(" ")}`);
    }
  }
  if (!leans.length) return;
  const t = outcomeTables(leans.map((l) => ({ score: l.features.confidence!.score, archr: l.prob, priceAmerican: l.features.price, won: l.result === "hit" ? 1 : 0 })));
  console.log("\n  By frozen grade (out of sample: the weights were set before these games):");
  for (const g of t.grades) console.log(bline(g));
  console.log("  By frozen score bucket (what any new cut would be fitted on):");
  for (const b of t.buckets) console.log(bline(b));
}

/** The live board, graded exactly as the screener pools grade it, with every factor. */
async function board() {
  const [verdicts, cards] = await Promise.all([getReportedBlendVerdicts(), getReportedGraded()]);
  console.log(`\n\n═══ LIVE BOARD DIAGNOSIS (graded as the screener grades it) · cuts: ${CUTS_LINE} ═══`);
  for (const sport of ["nba", "nfl"] as const) {
    const byStat = blendVerdictsByStat(sport, verdicts);
    const trusted = Object.entries(byStat).filter(([, v]) => v === "trusted").map(([k]) => k);
    console.log(`\n── ${sport.toUpperCase()} blend report cards: ${Object.entries(byStat).map(([k, v]) => `${k}=${v}`).join(", ") || "none saved"}`);
    console.log(`   Highest score the rules allow: ${maxPossible(true)} with a passing (trusted) card, ${maxPossible(false)} without. Trusted stats: ${trusted.join(", ") || "NONE — so A (≥ 75) is out of reach for every " + sport.toUpperCase() + " prop"}`);
    const rows = (await (sport === "nba" ? nbaScreener() : nflScreener())).filter((r) => r.archr !== null);
    const graded = rows.map((r) => {
      const input = poolConfidenceInput(
        { sport: r.sport, statKey: r.stat, archr: r.archr, priceAmerican: r.priceAmerican, rate: recordOf(r.rates.l10, r.rates.szn), fallbackGames: r.rates.szn[1] + r.rates.last[1], alt: !r.main, projectedMinutes: r.minutes ?? null, facts: r.facts },
        verdicts,
        cards
      );
      return { r, input, c: confidenceOf(input)! };
    });
    for (const main of [true, false]) {
      const set = graded.filter((g) => g.r.main === main);
      if (!set.length) continue;
      const cs = set.map((g) => g.c);
      const n = gradeCounts(cs);
      console.log(`\n   ${main ? "Main lines" : "Alt rungs"}: ${cs.length} graded · A ${n.A} · B ${n.B} · C ${n.C} · D ${n.D}`);
      console.log(`   Scores: ${scoreHistogram(cs.map((c) => c.score)).map((b) => `${b.bucket}:${b.n}`).join(" ")}`);
      console.log(`   Ceiling (score with every cost removed): ${cs.filter((c) => ceiling(c) >= 75).length} of ${cs.length} could reach A at all; highest ceiling ${Math.max(...cs.map(ceiling))}`);
      console.log("   Factor            moved   share   mean pts   biggest cost   grades changed without it");
      for (const f of factorSummary(cs)) console.log(`   ${f.key.padEnd(16)} ${String(f.moved).padStart(6)}  ${pct(f.share).padStart(6)}  ${f.meanEffect.toFixed(1).padStart(8)}   ${String(f.biggestCost).padStart(12)}   ${String(gradesChangedWithout(cs, f.key)).padStart(10)}`);
    }

    // Three real rows from the board, one per grade B, C, D: every factor and its points.
    for (const grade of ["B", "C", "D"] as const) {
      const pool = graded.filter((g) => g.r.main && g.c.grade === grade).sort((a, b) => a.c.score - b.c.score);
      const g = pool[Math.floor(pool.length / 2)];
      if (!g) continue;
      console.log(`\n   EXAMPLE ${grade}: ${g.r.player} ${g.r.side} ${g.r.point} ${g.r.statLabel} (${g.r.priceAmerican ?? "no price"}) · score ${g.c.score} = ${55} base`);
      for (const f of g.c.factors) console.log(`      ${(f.effect > 0 ? "+" : f.effect < 0 ? "−" : " ") + String(Math.abs(f.effect)).padStart(2)}  ${f.key.padEnd(9)} ${f.text}`);
      console.log(`      Biggest cost: ${biggestCost(g.c)?.key ?? "none"}`);
    }

    // (a) The sheet scores a missing blend card as not passing (−5) via `blendVerdicts[stat] ?? null`;
    //     pools pass the same null for blend sports and `undefined` (0) only for non-blend sports.
    const sheetVerdict = (stat: string) => byStat[stat] ?? null;
    const differ = graded.filter((g) => g.input.blendVerdict !== sheetVerdict(g.r.stat));
    const missing = graded.filter((g) => byStat[g.r.stat] === undefined);
    const neutralChanges = missing.filter((g) => gradeOf(Math.min(100, g.c.score + 5)) !== g.c.grade);
    console.log(`\n   (a) Sheet vs pool report-card input: ${differ.length} of ${graded.length} rows differ. Rows whose stat has no card: ${missing.length} (stats: ${[...new Set(missing.map((g) => g.r.stat))].join(", ") || "none"}); scored neutral instead of −5, ${neutralChanges.length} would change grade${neutralChanges[0] ? ` (e.g. ${neutralChanges[0].r.player} ${neutralChanges[0].r.statLabel}: ${neutralChanges[0].c.grade} ${neutralChanges[0].c.score} → ${gradeOf(neutralChanges[0].c.score + 5)} ${neutralChanges[0].c.score + 5})` : ""}`);

    // (b) No price (a projected line): −10.
    const unpriced = graded.filter((g) => g.input.priceAmerican === null);
    const priceChanges = unpriced.filter((g) => gradeOf(Math.min(100, g.c.score + 10)) !== g.c.grade);
    console.log(`   (b) Rows with no price: ${unpriced.length} of ${graded.length}; without the −10, ${priceChanges.length} would change grade${priceChanges[0] ? ` (e.g. ${priceChanges[0].r.player} ${priceChanges[0].r.statLabel}: ${priceChanges[0].c.grade} ${priceChanges[0].c.score} → ${gradeOf(priceChanges[0].c.score + 10)} ${priceChanges[0].c.score + 10})` : ""}`);
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
  await frozen().catch((e) => console.log(`\n(frozen-grade section skipped: ${e instanceof Error ? e.message : e})`));
  await board().catch((e) => console.log(`\n(board diagnosis skipped: ${e instanceof Error ? e.message : e})`));
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
