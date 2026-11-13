import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { auditFactors, MIN_PER_HALF, TAGS, type AuditSample, type CellStats, type FactorAudit } from "@/lib/audit/factorAudit";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { closingGameLines, teamBaselinesByGame } from "./props/history";
import { gradedNbaSides } from "./props/nbaGradedSides";
import { gradedNflSides } from "./props/nflGradedSides";
import { MIN_HALF_BETS, Z_DEGENERATE, bucketSweep, stablePositiveFloor, thresholdSweep, type Cell, type RoiStats, type ZSample } from "@/lib/audit/zPocket";

/**
 * The factor audit (lib/audit/factorAudit): where ARCHR's read holds up and
 * where it misses, by every factor we can tag a bet with, across three
 * sources:
 *
 *   NBA backtest  every graded NBA prop side with stored closing quotes,
 *                 rebuilt from prior games (as backtest:cautious-edge)
 *   NFL backtest  the same for NFL props
 *   Tracked leans every lean pick tracking froze before the game and graded
 *                 after (NBA/NFL props and game lines), with the closing line
 *
 * For each factor value: bias (ARCHR high or low), skill against the books'
 * own chance, ROI on ARCHR's edge bets, closing-line value where the close is
 * known — split into earlier and later halves; only effects that hold in both
 * get a "helps" or "hurts". Read-only. Run from the Model lab (script:
 * audit:factors).
 */
const pct = (x: number | null, d = 1) => (x === null || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const pts = (x: number | null) => (x === null || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`);
const stat = (c: CellStats) =>
  `n=${String(c.n).padStart(5)} · bias ${pts(c.bias).padStart(6)} pts · skill vs books ${c.skill === null ? "—" : (c.skill * 1000).toFixed(1).padStart(6)}‰ · edge bets ${String(c.edgeBets).padStart(4)} ROI ${pct(c.roi).padStart(7)}${c.clvN ? ` · CLV ${pts(c.clv)} pts (${c.clvN})` : ""}`;

function print(label: string, a: FactorAudit) {
  console.log(`\n═══ ${label}: ${a.n} graded bets ═══`);
  if (!a.n) return;
  console.log(`  ALL       ${stat(a.pool)}`);
  let factor = "";
  for (const c of a.cells) {
    if (c.factor !== factor) {
      factor = c.factor;
      console.log(`  ── ${factor}`);
    }
    const mark = c.verdict === "helps" ? "▲ HELPS" : c.verdict === "hurts" ? "▼ HURTS" : c.verdict === "mixed" ? "  mixed" : "  thin ";
    console.log(`  ${mark}  ${c.value.padEnd(34).slice(0, 34)} ${stat(c.all)}`);
  }
}

function minutesTag(m: { projected: number; recent: number | null } | null): string {
  if (!m) return "unknown";
  if (m.recent !== null && m.recent > 0 && Math.abs(m.projected / m.recent - 1) > 0.2) return "minutes in flux (>20% off recent)";
  if (m.projected < 18) return "small role (<18 min)";
  if (m.projected >= 32) return "big role (32+ min)";
  return "settled role (18–32 min)";
}

/* ═══ THE Z POCKET ═══════════════════════════════════════════════════════════
 * Fine |z| buckets (lib/audit/zPocket): ROI and bets for ARCHR's positive-edge
 * sides per bucket, both date halves; then every candidate floor (× ceiling)
 * with the volume it keeps. Measures only; the gate is a separate change. */
const roi = (r: RoiStats) => (r.roi === null ? "     —" : `${r.roi >= 0 ? "+" : ""}${(r.roi * 100).toFixed(1)}%`.padStart(7));
const ci = (r: RoiStats) => (r.lo === null ? "" : ` [${(r.lo * 100).toFixed(0)}, ${(r.hi! * 100).toFixed(0)}]`);
const cellLine = (c: Cell) =>
  `    ${c.label.padEnd(16)} n=${String(c.all.n).padStart(5)} ROI ${roi(c.all)}${ci(c.all).padEnd(12)} | early n=${String(c.early.n).padStart(4)} ${roi(c.early)} | late n=${String(c.late.n).padStart(4)} ${roi(c.late)}`;

function zPocket(label: string, rows: ZSample[]) {
  const withZ = rows.filter((r) => r.z !== null);
  console.log(`\n── ${label}: ${withZ.length} sides with a projection`);
  if (!withZ.length) return;
  console.log("  By |z| bucket (positive-edge bets only):");
  const buckets = bucketSweep(withZ);
  for (const b of buckets) console.log(cellLine(b));
  const floor = stablePositiveFloor(buckets);
  console.log(`  Stable floor (every bucket from here up returns ≥ 0 in both halves, ${MIN_HALF_BETS}+ bets a half): ${floor === null ? "NONE" : `|z| ≥ ${floor}`}`);
  console.log(`  Candidate thresholds (keep floor ≤ |z| < ceiling; |z| > ${Z_DEGENERATE} always out), with the share of edge bets kept:`);
  for (const t of thresholdSweep(withZ)) console.log(`${cellLine(t)} | keeps ${(t.kept * 100).toFixed(0).padStart(3)}%`);
}

async function main() {
  const out: { label: string; audit: FactorAudit }[] = [];
  const pocket: { label: string; rows: ZSample[] }[] = [];
  const failures: string[] = [];

  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
    const nba = await gradedNbaSides(closing, baselines);
    pocket.push({ label: "NBA props (backtest, closing prices)", rows: nba.map((s) => ({ p: s.pBlend, price: s.priceAmerican, won: s.won, z: s.z, date: s.date })) });
    out.push({
      label: "NBA props (backtest, closing prices)",
      audit: auditFactors(
        nba.map((s): AuditSample => ({
          p: s.pBlend,
          market: s.marketChance,
          price: s.priceAmerican,
          won: s.won,
          date: s.date,
          tags: {
            stat: s.stat,
            side: s.side,
            gap: TAGS.gap(s.pBlend, s.marketChance)!,
            price: TAGS.price(s.priceAmerican),
            record: TAGS.record(s.rate[0], s.rate[1], s.pBlend, s.priceAmerican),
            history: TAGS.sample(s.sampleGames),
            minutes: minutesTag(s.minutes),
          },
        }))
      ),
    });
  } catch (e) {
    failures.push(`NBA backtest: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nfl"), teamBaselinesByGame("nfl", 17)]);
    const nfl = await gradedNflSides(closing, baselines);
    pocket.push({ label: "NFL props (backtest, closing prices)", rows: nfl.map((s) => ({ p: s.pBlend, price: s.priceAmerican, won: s.won, z: s.z, date: s.date })) });
    out.push({
      label: "NFL props (backtest, closing prices)",
      audit: auditFactors(
        nfl.map((s): AuditSample => ({
          p: s.pBlend,
          market: s.marketChance,
          price: s.priceAmerican,
          won: s.won,
          date: s.date,
          tags: {
            stat: s.stat,
            side: s.side,
            gap: TAGS.gap(s.pBlend, s.marketChance)!,
            price: TAGS.price(s.priceAmerican),
            record: TAGS.record(s.rate[0], s.rate[1], s.pBlend, s.priceAmerican),
            history: TAGS.sample(s.sampleGames),
          },
        }))
      ),
    });
  } catch (e) {
    failures.push(`NFL backtest: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const leans = (await loadGradedLeans(240)).filter((l) => l.result === "hit" || l.result === "miss");
    const bySegment = new Map<string, AuditSample[]>();
    for (const l of leans) {
      const f = l.features;
      const seg = `${f.sport.toUpperCase()} ${f.kind === "prop" ? "props" : "game lines"}`;
      const tags: Record<string, string> = {
        market: `${f.sport.toUpperCase()} ${f.kind}`,
        side: f.side,
        price: TAGS.price(f.price),
        priced: f.priced ? "book-priced" : "number only (no price)",
      };
      const gap = TAGS.gap(l.prob, f.marketProb);
      if (gap) tags.gap = gap;
      if (f.kind === "prop") tags.stat = `${f.sport.toUpperCase()} ${f.stat}`;
      if (f.injury !== undefined) tags.injury = f.injury ? `tagged ${f.injury}` : "no tag";
      if (f.alt !== undefined) tags.line = f.alt ? "alt line" : "main line";
      if (f.confidence) tags.confidence = `grade ${f.confidence.grade}`;
      if (f.standout !== undefined) tags.standout = f.standout ? "made Hottest Tonight" : "didn't";
      if (typeof f.minutes === "number") tags.minutes = minutesTag({ projected: f.minutes, recent: null });
      if (typeof f.z === "number") tags.z = Math.abs(f.z) >= 0.75 ? "projection far from line (|z| ≥ .75)" : Math.abs(f.z) >= 0.35 ? "|z| .35–.75" : "projection near line (|z| < .35)";
      const s: AuditSample = { p: l.prob, market: f.marketProb, price: f.price, won: l.result === "hit" ? 1 : 0, close: l.closingProb, date: l.startsAt.toISOString().slice(0, 10), tags };
      (bySegment.get(seg) ?? bySegment.set(seg, []).get(seg)!).push(s);
    }
    for (const [seg, samples] of [...bySegment].sort()) out.push({ label: `Tracked leans · ${seg} (live, captured before the game)`, audit: auditFactors(samples) });
    for (const sport of ["nba", "nfl"] as const) {
      const props = leans.filter((l) => l.features.sport === sport && l.features.kind === "prop" && typeof l.features.z === "number");
      if (props.length)
        pocket.push({
          label: `${sport.toUpperCase()} props (tracked leans, live: price at capture, not the close)`,
          rows: props.map((l) => ({ p: l.prob, price: l.features.price, won: l.result === "hit" ? 1 : 0, z: l.features.z as number, date: l.startsAt.toISOString().slice(0, 10) })),
        });
    }
    if (!leans.length) failures.push("Tracked leans: none settled yet");
  } catch (e) {
    failures.push(`Tracked leans: ${e instanceof Error ? e.message : e}`);
  }

  console.log("FACTOR AUDIT — bias: ARCHR's chance minus the hit rate (+ runs high) · skill: books' Brier minus ARCHR's, per mille (+ ARCHR closer)");
  console.log(`ROI: flat stakes on ARCHR's positive-edge sides · CLV: the books' move toward the side by the close · HELPS/HURTS only when both date halves agree (${MIN_PER_HALF}+ a half)`);
  for (const { label, audit } of out) print(label, audit);

  console.log("\n═══ SUMMARY: consistent in both halves ═══");
  for (const { label, audit } of out) {
    const helps = audit.cells.filter((c) => c.verdict === "helps");
    const hurts = audit.cells.filter((c) => c.verdict === "hurts");
    console.log(`  ${label}`);
    console.log(`    ▲ ${helps.length ? helps.map((c) => `${c.factor}: ${c.value}`).join(" | ") : "none"}`);
    console.log(`    ▼ ${hurts.length ? hurts.map((c) => `${c.factor}: ${c.value}`).join(" | ") : "none"}`);
  }
  for (const f of failures) console.log(`  (skipped) ${f}`);

  console.log("\n\n═══ THE Z POCKET: |z| = |projection − line| / its spread · ROI on ARCHR's positive-edge sides, flat stakes, [95%] ═══");
  const backtests = pocket.filter((p) => p.label.includes("backtest"));
  for (const p of backtests) zPocket(p.label, p.rows);
  if (backtests.length > 1) zPocket("NBA + NFL props pooled (backtest, closing prices)", backtests.flatMap((p) => p.rows));
  for (const p of pocket.filter((x) => !x.label.includes("backtest"))) zPocket(p.label, p.rows);
  const live = pocket.filter((x) => !x.label.includes("backtest"));
  if (live.length > 1) zPocket("NBA + NFL props pooled (tracked leans, live)", live.flatMap((p) => p.rows));

  if (!out.some((o) => o.audit.n)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
