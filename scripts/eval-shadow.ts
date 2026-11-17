import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { SHADOW_MODELS } from "@/lib/tracking/types";
import { SHADOW_FEATURE_SCHEMA, type ShadowFeatures } from "@/lib/shadow/capture";
import { SHADOW_VERSION } from "@/lib/shadow/nbaShadow";
import { DECISION_GAMES, FORECASTERS, FORWARD_START, evRule, independence, lossGain, readGain, scoreOf, type ForwardRow } from "@/lib/shadow/forwardEval";
import { residualCorrelation } from "@/lib/audit/plusMoney";

/**
 * Forward validation of the NBA props shadow model (read-only;
 * docs/model-improvement-plan.md has the pre-registered protocol).
 *
 * Reads ONLY predictions frozen before tip by capture-leans under
 * SHADOW_MODELS.nbaProps, for games from FORWARD_START on, at the current
 * SHADOW_VERSION, and their settlements. Nothing here is fitted except the
 * reported diagnostics (the offset-logistic weight), and nothing is tuned.
 *
 * Each line is @@TAG@@{json}:
 *   INTEGRITY  rows captured / settled / pending, voids and pushes left out,
 *              any capture at or after tip (must be 0), duplicates (must be 0)
 *   SCORE      each forecaster's Brier, log loss and calibration
 *   GAIN       each forecaster vs the books' no-vig chance (log loss and
 *              Brier), game-cluster 95% intervals; s2 vs production
 *   INDEP      does each forecaster add information beyond the books
 *   RULE       the fixed EV rule's realized ROI and closing-line value
 *   CUT        the primary comparison on single vs combined stats (secondary)
 *   CORR       within-game residual correlation (why intervals resample games)
 *
 * Run: `npm run eval:shadow`.
 */
const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const r4 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const COMBOS = new Set(["pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"]);

async function main() {
  const preds = await prisma.modelPrediction.findMany({
    where: { run: { modelKey: SHADOW_MODELS.nbaProps, featureSchemaVersion: SHADOW_FEATURE_SCHEMA } },
    select: {
      id: true,
      eventRef: true,
      scheduledStartUtc: true,
      selectionKey: true,
      createdAt: true,
      featureSnapshot: true,
      run: { select: { generatedAt: true } },
      settlement: { select: { result: true, closingProb: true } },
    },
  });
  const inWindow = preds.filter((p) => etDateOf(p.scheduledStartUtc) >= FORWARD_START && (p.featureSnapshot as unknown as ShadowFeatures).version === SHADOW_VERSION);
  const afterTip = inWindow.filter((p) => p.run.generatedAt >= p.scheduledStartUtc || p.createdAt >= p.scheduledStartUtc);
  const keys = new Map<string, number>();
  for (const p of inWindow) keys.set(`${p.eventRef}|${p.selectionKey}`, (keys.get(`${p.eventRef}|${p.selectionKey}`) ?? 0) + 1);
  const results = new Map<string, number>();
  for (const p of inWindow) results.set(p.settlement?.result ?? "pending", (results.get(p.settlement?.result ?? "pending") ?? 0) + 1);

  const rows: ForwardRow[] = inWindow
    .filter((p) => !afterTip.includes(p) && (p.settlement?.result === "hit" || p.settlement?.result === "miss"))
    .map((p) => {
      const f = p.featureSnapshot as unknown as ShadowFeatures;
      return {
        cluster: p.eventRef,
        day: etDateOf(p.scheduledStartUtc),
        stat: f.stat,
        combo: COMBOS.has(f.stat),
        y: p.settlement!.result === "hit" ? 1 : 0,
        p: Object.fromEntries(FORECASTERS.map((k) => [k, f.over[k] ?? null])) as ForwardRow["p"],
        overPrice: f.market.overPrice,
        underPrice: f.market.underPrice,
        closeOver: p.settlement!.closingProb,
        absZ: Math.abs(f.prod.z),
      };
    });
  const games = new Set(rows.map((r) => r.cluster)).size;
  emit("INTEGRITY", {
    version: SHADOW_VERSION,
    forwardStart: FORWARD_START,
    captured: inWindow.length,
    results: Object.fromEntries(results),
    capturedAtOrAfterTip: afterTip.length,
    duplicates: [...keys.values()].filter((n) => n > 1).length,
    scored: rows.length,
    games,
    days: new Set(rows.map((r) => r.day)).size,
    decisionGames: DECISION_GAMES,
    stage: games >= DECISION_GAMES ? "decision" : "interim",
    withMarket: rows.filter((r) => r.p.market !== null).length,
  });
  if (!rows.length) return;

  // Score every forecaster on the rows the books priced, so all compare on the same props.
  const scored = rows.filter((r) => r.p.market !== null);
  for (const f of FORECASTERS) {
    const s = scoreOf(scored, f);
    emit("SCORE", { forecaster: f, n: s.n, games: s.games, brier: r4(s.brier), logloss: r4(s.logloss), ece: r4(s.ece), bins: s.bins.map((b) => ({ lo: b.lo, n: b.n, said: r4(b.meanP), won: r4(b.actual) })) });
  }
  for (const f of FORECASTERS.filter((x) => x !== "market")) {
    const ll = lossGain(scored, f, "market", "logloss");
    const br = lossGain(scored, f, "market", "brier");
    emit("GAIN", {
      forecaster: f,
      vs: "market",
      logloss: { perProp: r4(ll.est), lo: r4(ll.lo), hi: r4(ll.hi), games: ll.games },
      brier: { perProp: r4(br.est), lo: r4(br.lo), hi: r4(br.hi) },
      read: readGain(ll, ll.games),
      ...(f === "s2" ? { primary: true } : {}),
    });
  }
  for (const vs of ["prodRaw", "prodShown"] as const) {
    const g = lossGain(scored, "s2", vs, "logloss");
    emit("GAIN", { forecaster: "s2", vs, logloss: { perProp: r4(g.est), lo: r4(g.lo), hi: r4(g.hi), games: g.games } });
  }
  for (const f of FORECASTERS.filter((x) => x !== "market")) {
    const ind = independence(scored, f);
    emit("INDEP", {
      forecaster: f,
      weight: { est: r4(ind.weight.est), lo: r4(ind.weight.lo), hi: r4(ind.weight.hi), p: r4(ind.weight.p) },
      chrono: { trainN: ind.chrono.trainN, testN: ind.chrono.testN, gainPerMille: r4(ind.chrono.gain), lo: r4(ind.chrono.gainLo), hi: r4(ind.chrono.gainHi), pNoise: r4(ind.chrono.pNoise) },
    });
  }
  for (const f of FORECASTERS.filter((x) => x !== "market")) {
    const r = evRule(scored, f);
    emit("RULE", { forecaster: f, bets: r.bets, games: r.games, overs: r.overs, roi: { est: r4(r.roi.est), lo: r4(r.roi.lo), hi: r4(r.roi.hi) }, clv: { n: r.clv.n, est: r4(r.clv.est), lo: r4(r.clv.lo), hi: r4(r.clv.hi) } });
  }
  for (const [name, sub] of [
    ["single stats", scored.filter((r) => !r.combo)],
    ["combined stats", scored.filter((r) => r.combo)],
    ["production |z| >= 0.55", scored.filter((r) => (r.absZ ?? 0) >= 0.55)],
  ] as const) {
    const g = lossGain(sub, "s2", "market");
    const p = lossGain(sub, "prodShown", "market");
    emit("CUT", { cut: name, secondary: true, n: g.n, games: g.games, s2: { perProp: r4(g.est), lo: r4(g.lo), hi: r4(g.hi) }, prodShown: { perProp: r4(p.est), lo: r4(p.lo), hi: r4(p.hi) } });
  }
  const corr = residualCorrelation(scored.map((r) => ({ cluster: r.cluster, day: r.day, won: r.y, market: r.p.market, p: r.p.s2! })));
  emit("CORR", corr);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
