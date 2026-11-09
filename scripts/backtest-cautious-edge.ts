import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { CALIBRATION_SHRINK, projectProp, rawOver } from "@/lib/nba/projection";
import type { GameLogPoint, PropQuote } from "@/lib/nba/propsMath";
import { propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { shrinkLogit } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { DEFAULT_MODEL_WEIGHT, blendWithMarket, marketRead } from "@/lib/propModel/market";
import {
  MIN_GATE_SAMPLES,
  cautiousVerdict,
  evidenceGate,
  gradeCautiousSamples,
  type CautiousBucket,
  type CautiousGradeSample,
  type ProbScore,
} from "@/lib/propModel/cautiousGrade";
import { roleWeightedRecord, EVIDENCE_PRIOR_GAMES, type TonightRole } from "@/lib/propModel/cautiousRead";
import { CAUTIOUS_READ_MODE } from "@/lib/propModel/canonical";
import { projectNbaMinutes } from "@/lib/nba/minutes";
import { closingGameLines, teamBaselinesByGame, type TeamBaseline } from "./props/history";

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

function closingQuotes<T extends { playerId: string; stat: string; bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date }>(
  snaps: T[],
  start: Date
): Map<string, PropQuote[]> {
  const latest = new Map<string, T>();
  for (const s of snaps) {
    if (s.polledAt >= start) continue;
    const k = `${s.playerId}|${s.stat}|${s.bookKey}|${s.side}|${s.point}`;
    const prev = latest.get(k);
    if (!prev || s.polledAt > prev.polledAt) latest.set(k, s);
  }
  const out = new Map<string, PropQuote[]>();
  for (const s of latest.values()) {
    const k = `${s.playerId}|${s.stat}`;
    const list = out.get(k) ?? [];
    list.push({ bookKey: s.bookKey, bookName: s.bookKey, side: s.side === "under" ? "under" : "over", point: s.point, priceAmerican: s.priceAmerican });
    out.set(k, list);
  }
  return out;
}

interface GradedCautious extends CautiousGradeSample {
  stat: string;
  side: "over" | "under";
}

async function gradedNba(closing: Map<string, GameLines>, baselines: Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>): Promise<GradedCautious[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nba", status: "final", nbaPropSnapshots: { some: {} } },
    select: { id: true, scheduledStartUtc: true },
  });
  const out: GradedCautious[] = [];
  for (const g of games) {
    const snaps = await prisma.nbaPropSnapshot.findMany({ where: { gameId: g.id } });
    const quotes = closingQuotes(snaps.map((s) => ({ ...s, playerId: s.nbaPlayerId })), g.scheduledStartUtc);
    const playerIds = [...new Set(snaps.map((s) => s.nbaPlayerId))];
    const logs = await prisma.nbaPlayerGameLog.findMany({
      where: { nbaPlayerId: { in: playerIds }, gameDate: { lte: g.scheduledStartUtc }, minutes: { gt: 0 } },
      orderBy: { gameDate: "desc" },
    });
    for (const [key, qs] of quotes) {
      const [playerId, statKey] = key.split("|");
      const stat = NBA_PROP_STATS.find((s) => s.key === statKey);
      const mine = logs.filter((l) => l.nbaPlayerId === playerId);
      const tonight = mine.find((l) => l.gameId === g.id);
      if (!stat || !tonight) continue;
      const point = propConsensusPoint(qs);
      if (point === null) continue;
      const market = marketRead(twoSidedAt(qs, point));
      if (!market) continue;
      const history: GameLogPoint[] = mine
        .filter((l) => l.gameId !== g.id && l.gameDate < g.scheduledStartUtc)
        .map((l) => ({ ...l, date: etDateOf(l.gameDate), opponent: "" }));
      const base = baselines.get(g.id);
      const proj = projectProp(history, stat, {
        defense: { season: 0, fromLastSeason: false, teams: {} },
        opponent: null,
        positionGroup: null,
        lines: closing.get(g.id) ?? NO_LINES,
        isHome: tonight.isHome,
        baselineTotal: (tonight.isHome ? base?.home : base?.away)?.combined ?? null,
        season: tonight.season,
      });
      if (!proj) continue;
      const actual = stat.value(tonight);
      if (actual === point) continue; // push
      const pModel = shrinkLogit(rawOver(proj, point), CALIBRATION_SHRINK);
      const pOver = blendWithMarket(pModel, market.probOver, DEFAULT_MODEL_WEIGHT);
      // That night's expected role, from prior games only (no lineups stored historically).
      const m = projectNbaMinutes(history, { date: etDateOf(g.scheduledStartUtc) });
      const role: TonightRole | null = m ? { minutes: m.minutes, starter: m.role === null ? null : m.role === "starter" } : null;
      const record = history.map((l) => ({ value: stat.value(l), minutes: l.minutes, starter: l.starter }));
      for (const side of ["over", "under"] as const) {
        // The screener's record: the player's last 10 games before tonight, at this line, on this side.
        const rate = roleWeightedRecord(record, side, point, null, 10);
        const roleRate = role ? roleWeightedRecord(record, side, point, role, 10) : null;
        // The best closing price on this side at this line — the price the cautious edge reads against.
        const prices = qs.filter((q) => q.point === point && q.side === side).map((q) => q.priceAmerican);
        const won = (side === "over" ? actual > point : actual < point) ? 1 : 0;
        out.push({
          stat: statKey,
          side,
          pBlend: side === "over" ? pOver : 1 - pOver,
          rate,
          roleRate,
          priceAmerican: prices.length ? Math.max(...prices) : null,
          won,
        });
      }
    }
  }
  return out;
}

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
  let graded: GradedCautious[];
  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
    graded = await gradedNba(closing, baselines);
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
