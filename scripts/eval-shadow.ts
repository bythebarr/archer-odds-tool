import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { SHADOW_MODELS } from "@/lib/tracking/types";
import { SHADOW_FEATURE_SCHEMA, SHADOW_V2_FEATURE_SCHEMA, type ShadowV2Features } from "@/lib/shadow/capture";
import { SHADOW_VERSION } from "@/lib/shadow/nbaShadow";
import { V2_VERSION } from "@/lib/shadow/v2";
import { CANDIDATE_RULE } from "@/lib/shadow/marketValue";
import { DECISION_GAMES, FORECASTERS, FORWARD_START, candidateRule, evRule, independence, lossGain, readGain, scoreOf, type Forecaster, type ForwardRow } from "@/lib/shadow/forwardEval";
import { residualCorrelation } from "@/lib/audit/plusMoney";

/**
 * Forward validation of the NBA props shadow models (read-only;
 * docs/model-improvement-plan.md and docs/alpha-sprint.md have the
 * pre-registered protocol). Each version is read on its own: its own model
 * key, its own records, its own start (the first game it froze before tip,
 * never earlier than FORWARD_START).
 *
 *   v1  shadow:nba-props     forecasters market, prod*, s1, s2
 *   v2  shadow:nba-props-v2  + corr (projection fix alone) and v2 (combined),
 *                            and the frozen plus-money candidate rule
 *
 * Reads ONLY predictions frozen before tip, at the version's current code
 * version, and their settlements. Nothing is fitted except the reported
 * diagnostics, and nothing is tuned.
 *
 * Each line is @@TAG@@{json}, tagged with the version:
 *   INTEGRITY  captured / settled / pending; captures at or after tip and duplicates (both must be 0)
 *   SCORE      each forecaster's Brier, log loss and calibration
 *   GAIN       each forecaster vs the books' no-vig chance (primary: s2 for v1, v2 for v2)
 *   INDEP      does each forecaster add information beyond the books
 *   RULE       one fixed EV rule's realized ROI and CLV (all prices, and +100..+175 only)
 *   CANDIDATES the frozen candidate rule's picks: ROI, CLV, picks per slate (v2)
 *   CUT        secondary cuts: single vs combined stats, production |z| ≥ 0.55, plus-money props
 *   CORR       within-game residual correlation (why intervals resample games)
 *
 * Run: `npm run eval:shadow`.
 */
const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const r4 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const COMBOS = new Set(["pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"]);
const PLUS: [number, number] = [CANDIDATE_RULE.minPrice, CANDIDATE_RULE.maxPrice];

const VERSIONS = [
  { name: "v1", key: SHADOW_MODELS.nbaProps, schema: SHADOW_FEATURE_SCHEMA, version: SHADOW_VERSION, primary: "s2" as Forecaster, forecasters: FORECASTERS.filter((f) => f !== "corr" && f !== "v2") },
  { name: "v2", key: SHADOW_MODELS.nbaPropsV2, schema: SHADOW_V2_FEATURE_SCHEMA, version: V2_VERSION, primary: "v2" as Forecaster, forecasters: [...FORECASTERS] },
] as const;

async function evaluate(v: (typeof VERSIONS)[number]) {
  const tag = (t: string, o: object) => emit(t, { version: v.name, ...o });
  const preds = await prisma.modelPrediction.findMany({
    where: { run: { modelKey: v.key, featureSchemaVersion: v.schema } },
    select: {
      eventRef: true,
      scheduledStartUtc: true,
      selectionKey: true,
      createdAt: true,
      featureSnapshot: true,
      run: { select: { generatedAt: true } },
      settlement: { select: { result: true, closingProb: true } },
    },
  });
  const inWindow = preds.filter((p) => etDateOf(p.scheduledStartUtc) >= FORWARD_START && (p.featureSnapshot as unknown as { version: string }).version === v.version);
  const afterTip = new Set(inWindow.filter((p) => p.run.generatedAt >= p.scheduledStartUtc || p.createdAt >= p.scheduledStartUtc));
  const keys = new Map<string, number>();
  for (const p of inWindow) keys.set(`${p.eventRef}|${p.selectionKey}`, (keys.get(`${p.eventRef}|${p.selectionKey}`) ?? 0) + 1);
  const results = new Map<string, number>();
  for (const p of inWindow) results.set(p.settlement?.result ?? "pending", (results.get(p.settlement?.result ?? "pending") ?? 0) + 1);
  const firstDay = inWindow.map((p) => etDateOf(p.scheduledStartUtc)).sort()[0] ?? null;

  const rows: ForwardRow[] = inWindow
    .filter((p) => !afterTip.has(p) && (p.settlement?.result === "hit" || p.settlement?.result === "miss"))
    .map((p) => {
      const f = p.featureSnapshot as unknown as ShadowV2Features;
      const over = f.over as Partial<Record<Forecaster, number | null>>;
      return {
        cluster: p.eventRef,
        day: etDateOf(p.scheduledStartUtc),
        stat: f.stat,
        combo: COMBOS.has(f.stat),
        y: p.settlement!.result === "hit" ? 1 : 0,
        p: Object.fromEntries(FORECASTERS.map((k) => [k, over[k] ?? null])) as ForwardRow["p"],
        overPrice: f.market.overPrice,
        underPrice: f.market.underPrice,
        closeOver: p.settlement!.closingProb,
        absZ: Math.abs(f.prod.z),
        candidate: f.candidate?.side ?? null,
      };
    });
  const games = new Set(rows.map((r) => r.cluster)).size;
  tag("INTEGRITY", {
    codeVersion: v.version,
    forwardStart: firstDay,
    captured: inWindow.length,
    results: Object.fromEntries(results),
    capturedAtOrAfterTip: afterTip.size,
    duplicates: [...keys.values()].filter((n) => n > 1).length,
    scored: rows.length,
    games,
    days: new Set(rows.map((r) => r.day)).size,
    decisionGames: DECISION_GAMES,
    stage: games >= DECISION_GAMES ? "decision" : "interim",
    withMarket: rows.filter((r) => r.p.market !== null).length,
  });
  if (!rows.length) return;

  // Every forecaster on the same props: those the books priced two-sided at capture.
  const scored = rows.filter((r) => r.p.market !== null);
  for (const f of v.forecasters) {
    const s = scoreOf(scored, f);
    tag("SCORE", { forecaster: f, n: s.n, games: s.games, brier: r4(s.brier), logloss: r4(s.logloss), ece: r4(s.ece), bins: s.bins.map((b) => ({ lo: b.lo, n: b.n, said: r4(b.meanP), won: r4(b.actual) })) });
  }
  for (const f of v.forecasters.filter((x) => x !== "market")) {
    const ll = lossGain(scored, f, "market", "logloss");
    const br = lossGain(scored, f, "market", "brier");
    tag("GAIN", {
      forecaster: f,
      vs: "market",
      logloss: { perProp: r4(ll.est), lo: r4(ll.lo), hi: r4(ll.hi), games: ll.games },
      brier: { perProp: r4(br.est), lo: r4(br.lo), hi: r4(br.hi) },
      read: readGain(ll, ll.games),
      ...(f === v.primary ? { primary: true } : {}),
    });
  }
  for (const vs of ["prodRaw", "prodShown", ...(v.name === "v2" ? (["s2"] as const) : [])] as Forecaster[]) {
    const g = lossGain(scored, v.primary, vs, "logloss");
    tag("GAIN", { forecaster: v.primary, vs, logloss: { perProp: r4(g.est), lo: r4(g.lo), hi: r4(g.hi), games: g.games } });
  }
  for (const f of v.forecasters.filter((x) => x !== "market")) {
    const ind = independence(scored, f);
    tag("INDEP", {
      forecaster: f,
      weight: { est: r4(ind.weight.est), lo: r4(ind.weight.lo), hi: r4(ind.weight.hi), p: r4(ind.weight.p) },
      chrono: { trainN: ind.chrono.trainN, testN: ind.chrono.testN, gainPerMille: r4(ind.chrono.gain), lo: r4(ind.chrono.gainLo), hi: r4(ind.chrono.gainHi), pNoise: r4(ind.chrono.pNoise) },
    });
  }
  for (const f of v.forecasters.filter((x) => x !== "market")) {
    for (const [label, range] of [
      ["all prices", undefined],
      ["+100 to +175 only", PLUS],
    ] as const) {
      const r = evRule(scored, f, 0, range);
      tag("RULE", { forecaster: f, prices: label, bets: r.bets, games: r.games, overs: r.overs, roi: { est: r4(r.roi.est), lo: r4(r.roi.lo), hi: r4(r.roi.hi) }, clv: { n: r.clv.n, est: r4(r.clv.est), lo: r4(r.clv.lo), hi: r4(r.clv.hi) } });
    }
  }
  if (v.name === "v2") {
    const c = candidateRule(rows);
    const days = Object.values(c.perDay);
    tag("CANDIDATES", {
      rule: CANDIDATE_RULE.id,
      picks: c.bets,
      games: c.games,
      overs: c.overs,
      roi: { est: r4(c.roi.est), lo: r4(c.roi.lo), hi: r4(c.roi.hi) },
      clv: { n: c.clv.n, est: r4(c.clv.est), lo: r4(c.clv.lo), hi: r4(c.clv.hi) },
      perSlate: { days: days.length, mean: r4(days.reduce((a, b) => a + b, 0) / Math.max(days.length, 1)), zero: days.filter((d) => d === 0).length, six: days.filter((d) => d >= 6).length },
    });
  }
  const plusMoney = (r: ForwardRow) => (r.overPrice !== null && r.overPrice >= PLUS[0] && r.overPrice <= PLUS[1]) || (r.underPrice !== null && r.underPrice >= PLUS[0] && r.underPrice <= PLUS[1]);
  for (const [name, sub] of [
    ["single stats", scored.filter((r) => !r.combo)],
    ["combined stats", scored.filter((r) => r.combo)],
    ["production |z| >= 0.55", scored.filter((r) => (r.absZ ?? 0) >= 0.55)],
    ["a side priced +100 to +175", scored.filter(plusMoney)],
  ] as const) {
    const g = lossGain(sub, v.primary, "market");
    const p = lossGain(sub, "prodShown", "market");
    tag("CUT", { cut: name, secondary: true, n: g.n, games: g.games, [v.primary]: { perProp: r4(g.est), lo: r4(g.lo), hi: r4(g.hi) }, prodShown: { perProp: r4(p.est), lo: r4(p.lo), hi: r4(p.hi) } });
  }
  tag("CORR", residualCorrelation(scored.map((r) => ({ cluster: r.cluster, day: r.day, won: r.y, market: r.p.market, p: r.p[v.primary]! }))));
}

async function main() {
  for (const v of VERSIONS) await evaluate(v);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
