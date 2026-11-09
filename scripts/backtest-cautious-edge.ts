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
import { gradeCautiousSamples, cautiousVerdict, type CautiousGradeSample } from "@/lib/propModel/cautiousGrade";
import { closingGameLines, teamBaselinesByGame, type TeamBaseline } from "./props/history";

/**
 * Grade the haircut (Phase 6): the head-to-head the conservative/cautious
 * edge never had. On every graded NBA prop with stored snapshots — the same
 * collection as backtest:props-market — reconstruct, from prior games only:
 *
 *   - ARCHR Chance: the blend (calibrated model + de-vigged closing
 *     consensus) at DEFAULT_MODEL_WEIGHT — the weight every NBA stat
 *     actually prices at today, since all sit below MIN_FIT_SAMPLES.
 *   - the cautious read: min(ARCHR Chance, Wilson floor of the player's L10
 *     record at the consensus line), and its edge vs the best closing price.
 *
 * Then score both probabilities against the actual result (log loss, Brier,
 * mean predicted vs actual) and bucket by cautious-edge size: when the
 * cautious edge calls a prop strong, does it cash more than its price
 * implies? Pure scoring lives in lib/propModel/cautiousGrade (unit-tested
 * on synthetic data); this script is the DB collection + print.
 *
 * Known reconstruction limits, same family as backtest:props-market: no
 * injury adjustment (not stored historically), and the record is the L10
 * window the screener uses.
 *
 * Needs the production DATABASE_URL (the .env drop). With no DB access it
 * fails loud, never green. Run: `npm run backtest:cautious-edge`.
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
      const pBlend = blendWithMarket(pModel, market.probOver, DEFAULT_MODEL_WEIGHT);
      // The screener's record: the player's last 10 games before tonight, at this line.
      const l10 = history.slice(0, 10);
      const hits = l10.filter((l) => stat.value(l) > point).length;
      // The best closing price on the Over at this line — the price the cautious edge reads against.
      const overPrices = qs.filter((q) => q.point === point && q.side === "over").map((q) => q.priceAmerican);
      const best = overPrices.length ? Math.max(...overPrices) : null;
      out.push({ stat: statKey, pBlend, rate: [hits, l10.length], priceAmerican: best, won: actual > point ? 1 : 0 });
    }
  }
  return out;
}

function printGrade(label: string, samples: CautiousGradeSample[]) {
  const g = gradeCautiousSamples(samples);
  console.log(`\n${label}: ${g.n} graded props (${g.pricedN} priced)`);
  if (!g.n) return;
  console.log(`  blend    — log loss ${g.blend.logLoss.toFixed(4)} · Brier ${g.blend.brier.toFixed(4)} · mean predicted ${(g.blend.meanProb * 100).toFixed(1)}% vs actual ${(g.blend.hitRate * 100).toFixed(1)}%`);
  if (g.pricedN) {
    console.log(`  cautious — log loss ${g.cautious.logLoss.toFixed(4)} · Brier ${g.cautious.brier.toFixed(4)} · mean predicted ${(g.cautious.meanProb * 100).toFixed(1)}% vs actual ${(g.cautious.hitRate * 100).toFixed(1)}%`);
    console.log(`  verdict  — ${cautiousVerdict(g)}`);
    console.log(`  buckets by cautious edge (hit rate vs the chance the price implied):`);
    for (const b of g.buckets) {
      if (!b.n) continue;
      console.log(`    ${b.label.padEnd(20)} n=${String(b.n).padStart(4)} · hit ${(b.hitRate * 100).toFixed(1)}% vs implied ${(b.meanImplied * 100).toFixed(1)}% · blend LL ${b.blendLogLoss.toFixed(4)} · cautious LL ${b.cautiousLogLoss.toFixed(4)}`);
    }
    if (g.distrustedN) console.log(`  note: ${g.distrustedN} priced sample(s) sat past the +50% trust cap (counted in the distrusted bucket, excluded from nothing here — grading sees everything).`);
  }
}

async function main() {
  const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
  const graded = await gradedNba(closing, baselines);
  if (!graded.length) {
    console.error("No graded NBA props with a market and a projection — nothing to grade. Exiting non-zero so the run is loud, not green.");
    process.exitCode = 1;
    return;
  }
  printGrade("NBA — all stats", graded);
  for (const stat of [...new Set(graded.map((g) => g.stat))]) {
    printGrade(`NBA — ${stat}`, graded.filter((g) => g.stat === stat));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
