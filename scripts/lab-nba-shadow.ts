import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NBA_PROP_STAT_BY_KEY, type NbaPropStatDef } from "@/lib/nba/propStats";
import { projectProp, type PropProjection } from "@/lib/nba/projection";
import { MINUTES_PARAMS, projectNbaMinutes } from "@/lib/nba/minutes";
import {
  MINUTES_FEATURES,
  SHADOW_PARAMS,
  minutesFeatures,
  minutesScale,
  mixturePmf,
  nbPmf,
  ols,
  perMinuteDispersion,
  quantileNodes,
  shadowDistribution,
  type ShadowParams,
  type ShadowVariant,
} from "@/lib/shadow/nbaShadow";
import { attachNbaPostGame, loadGradedLeans } from "@/lib/queries/edgeReport";
import { loadNbaReplay, type ReplayLog } from "./props/nbaReplay";

/**
 * Shadow-model lab (read-only): the root-cause investigation behind
 * docs/model-improvement-plan.md, and the one fit of the shadow model's
 * constants (lib/shadow/nbaShadow.ts SHADOW_PARAMS).
 *
 * Walk-forward replay of every NBA player-game with 10+ earlier games
 * (scripts/props/nbaReplay.ts: the live projection's context rebuilt from
 * what was known before each date). Three sets, never mixed:
 *
 *   FIT    the earlier season (2025-26): every constant is fitted here, once.
 *   CHECK  this season before Nov 17 (2026-27): read once to confirm the
 *          fitted shadow isn't worse; nothing is tuned on it. It overlaps the
 *          Nov 6–16 sample the audits already read, so it is not evidence of
 *          an edge — only a sanity check.
 *   FORWARD games from Nov 17 on: never touched here (eval:shadow reads them
 *          from the predictions frozen before tip).
 *
 * Sections (each line @@TAG@@{json}):
 *   1. MIN_*   minutes misses: overall bias, the pregame features that predict
 *              big misses (fit and check side by side), the fitted miss-scale
 *              model and whether it ranks misses out of sample, and whether
 *              down-weighting early exits biases the projection upward.
 *   2. VAR_*   projection spread: standardized residual SD by distance from a
 *              stand-in line (production vs s1 vs s2), log score, interval
 *              coverage, and line calibration.
 *   3. BIAS_*  combined-stat bias: actual − projection by stat, split into the
 *              minutes part and the per-minute-rate part, by distance from the
 *              line (selection), and on the tracked leans (real lines).
 *   4. PARAMS  the fitted SHADOW_PARAMS to freeze.
 *
 * Run: `npm run lab:nba-shadow`.
 */
const FORWARD_START = "2026-11-17";
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"] as const;
const COMBOS = new Set(["pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"]);
const BIG_MISS = 8;
const Z_BUCKETS: [number, number][] = [
  [0, 0.2],
  [0.2, 0.35],
  [0.35, 0.55],
  [0.55, 0.75],
  [0.75, 1],
  [1, 99],
];
const KAPPA_GRID = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.3, 2.6];
const KAPPA_SAMPLE = 4000;

const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sdOf = (xs: number[]) => {
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length - 1, 1));
};
const corr = (a: number[], b: number[]) => {
  const ma = avg(a);
  const mb = avg(b);
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
};

interface PlayerGame {
  set: "fit" | "check";
  game: ReplayLog;
  history: ReplayLog[];
  proj: Partial<Record<(typeof STATS)[number], PropProjection>>;
  features: number[];
  minutesMiss: number;
  /** The minutes projection with early exits weighted like any game: the down-weighting hypothesis. */
  minutesNoExitWeight: number | null;
}

/** Deterministic subsample (every k-th). */
const every = <T>(xs: T[], n: number) => (xs.length <= n ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / n) === 0));

/** The distribution of one method for one row, as a pmf array with its mean and sd. */
function methodPmf(method: "prod" | ShadowVariant, pg: PlayerGame, key: (typeof STATS)[number], params: ShadowParams): { pmf: number[]; mean: number; sd: number } | null {
  const proj = pg.proj[key]!;
  const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
  if (method === "prod") {
    const d = proj.distribution;
    if (d.kind !== "count") return null;
    const kmax = Math.ceil(d.mean + 10 * Math.sqrt(d.variance) + 10);
    return { pmf: nbPmf(d.mean, d.variance, kmax), mean: d.mean, sd: Math.sqrt(d.variance) };
  }
  const d = shadowDistribution(proj, pg.history, stat, method, params);
  if (!d) return null;
  const kmax = Math.ceil(Math.max(...d.components.map((c) => c.mean + 10 * Math.sqrt(c.variance))) + 10);
  return { pmf: mixturePmf(d, kmax), mean: d.mean, sd: d.sd };
}

function overOf(pmf: number[], line: number): number {
  let below = 0;
  for (let k = 0; k <= Math.floor(line) && k < pmf.length; k++) below += pmf[k];
  return Math.min(Math.max(1 - below, 1e-6), 1 - 1e-6);
}

function quantileOf(pmf: number[], q: number): number {
  let c = 0;
  for (let k = 0; k < pmf.length; k++) {
    c += pmf[k];
    if (c >= q) return k;
  }
  return pmf.length - 1;
}

async function main() {
  const replay = await loadNbaReplay();
  const seasons = new Map<number, number>();
  for (const games of replay.byPlayer.values()) for (const g of games) seasons.set(g.season, (seasons.get(g.season) ?? 0) + 1);
  const ordered = [...seasons.keys()].sort((a, b) => a - b);
  const current = ordered[ordered.length - 1];
  const fitSeason = Number(process.env.FIT_SEASON ?? ordered[ordered.length - 2]);
  emit("SETUP", { rows: replay.rows, players: replay.byPlayer.size, seasons: Object.fromEntries(seasons), fitSeason, checkSeason: current, forwardStart: FORWARD_START });

  // ---- The replay -----------------------------------------------------------
  const pgs: PlayerGame[] = [];
  for (const games of replay.byPlayer.values()) {
    for (let i = 10; i < games.length; i++) {
      const game = games[i];
      if (game.date >= FORWARD_START) continue; // forward games are never read here
      const set = game.season === fitSeason ? "fit" : game.season === current ? "check" : null;
      if (!set) continue;
      const history = games.slice(0, i).reverse();
      const ctx = replay.contextFor(game);
      const proj: PlayerGame["proj"] = {};
      for (const key of STATS) {
        const p = projectProp(history, NBA_PROP_STAT_BY_KEY.get(key)!, ctx);
        if (p && p.sd > 0) proj[key] = p;
      }
      const base = proj.points;
      if (!base || !(base.minutes > 0)) continue;
      const noExit = projectNbaMinutes(history, { date: ctx.date, team: ctx.team, teamDates: ctx.teamDates, absences: ctx.absences }, { ...MINUTES_PARAMS, exitWeight: 1 });
      pgs.push({
        set,
        game,
        history,
        proj,
        features: minutesFeatures(base, history),
        minutesMiss: game.minutes - base.minutes,
        minutesNoExitWeight: noExit ? noExit.minutes * base.env.minutesFactor : null,
      });
    }
  }
  const fit = pgs.filter((p) => p.set === "fit");
  const check = pgs.filter((p) => p.set === "check");
  emit("REPLAY", { playerGames: pgs.length, fit: fit.length, check: check.length, fitGames: new Set(fit.map((p) => p.game.gameId)).size, checkGames: new Set(check.map((p) => p.game.gameId)).size });

  // ---- 1. Minutes -----------------------------------------------------------
  const minutesSummary = (xs: PlayerGame[]) => {
    const miss = xs.map((p) => p.minutesMiss);
    const sorted = [...miss].sort((a, b) => a - b);
    const noExit = xs.filter((p) => p.minutesNoExitWeight !== null).map((p) => p.game.minutes - p.minutesNoExitWeight!);
    const l10 = xs.map((p) => p.game.minutes - avg(p.history.slice(0, 10).map((l) => l.minutes)));
    return {
      n: xs.length,
      bias: r3(avg(miss)),
      medianMiss: r3(sorted[Math.floor(sorted.length / 2)]),
      mae: r3(avg(miss.map(Math.abs))),
      bigMissRate: r3(miss.filter((m) => Math.abs(m) >= BIG_MISS).length / miss.length),
      shortRate: r3(miss.filter((m) => m <= -BIG_MISS).length / miss.length),
      longRate: r3(miss.filter((m) => m >= BIG_MISS).length / miss.length),
      noExitWeightBias: r3(avg(noExit)),
      noExitWeightMae: r3(avg(noExit.map(Math.abs))),
      l10AvgBias: r3(avg(l10)),
      l10AvgMae: r3(avg(l10.map(Math.abs))),
    };
  };
  emit("MIN_SUMMARY", { fit: minutesSummary(fit), check: minutesSummary(check) });

  // Each pregame feature, bucketed: does it predict a big miss, in both sets?
  const featureBuckets: Record<string, (x: number) => string> = {
    sd10: (x) => (x < 3 ? "<3" : x < 5 ? "3-5" : x < 7 ? "5-7" : "7+"),
    bench: (x) => (x ? "bench" : "starter/unknown"),
    returning: (x) => (x ? "returning" : "no"),
    teammatesOut: (x) => (x ? "yes" : "no"),
    spreadAbs: (x) => (x < 4 ? "<4" : x < 8 ? "4-8" : x < 12 ? "8-12" : "12+"),
    backToBack: (x) => (x ? "b2b" : "rested"),
    shortGames10: (x) => (x === 0 ? "0" : x === 1 ? "1" : "2+"),
    newPlayer: (x) => (x ? "<15 games" : "15+"),
    roleFlux: (x) => (x ? "3-7 starts" : "stable"),
    projMinutes: (x) => (x < 15 ? "<15" : x < 22 ? "15-22" : x < 30 ? "22-30" : x < 35 ? "30-35" : "35+"),
  };
  for (const [name, bucket] of Object.entries(featureBuckets)) {
    const idx = MINUTES_FEATURES.indexOf(name as (typeof MINUTES_FEATURES)[number]);
    const cut = (xs: PlayerGame[]) => {
      const g = new Map<string, number[]>();
      for (const p of xs) {
        const b = bucket(p.features[idx]);
        (g.get(b) ?? g.set(b, []).get(b)!).push(p.minutesMiss);
      }
      return Object.fromEntries(
        [...g].map(([b, m]) => [b, { n: m.length, bias: r3(avg(m)), mae: r3(avg(m.map(Math.abs))), bigMiss: r3(m.filter((x) => Math.abs(x) >= BIG_MISS).length / m.length), short: r3(m.filter((x) => x <= -BIG_MISS).length / m.length) }])
      );
    };
    emit("MIN_FEATURE", { feature: name, fit: cut(fit), check: cut(check) });
  }

  // The miss-scale model, fitted on FIT only.
  const minutesCoef = ols(
    fit.map((p) => p.features),
    fit.map((p) => Math.abs(p.minutesMiss))
  );
  const minScale = SHADOW_PARAMS.minScale;
  const scaleOf = (p: PlayerGame) => minutesScale(p.features, { ...SHADOW_PARAMS, minutesCoef, minScale });
  const nodes = quantileNodes(
    fit.map((p) => p.minutesMiss / scaleOf(p)),
    SHADOW_PARAMS.nodes.length
  );
  const scaleCheck = (xs: PlayerGame[]) => {
    const pred = xs.map(scaleOf);
    const real = xs.map((p) => Math.abs(p.minutesMiss));
    // Deciles of the predicted scale: realized mean absolute miss in each.
    const order = xs.map((_, i) => i).sort((a, b) => pred[a] - pred[b]);
    const deciles = Array.from({ length: 10 }, (_, d) => {
      const ids = order.slice(Math.floor((d * order.length) / 10), Math.floor(((d + 1) * order.length) / 10));
      return { predicted: r3(avg(ids.map((i) => pred[i]))), realized: r3(avg(ids.map((i) => real[i]))), bigMiss: r3(ids.filter((i) => real[i] >= BIG_MISS).length / ids.length) };
    });
    // Coverage of the mixture's 10–90% band (nodes are equal-weight quantile midpoints; the outer two span ~10%/90%).
    const lo = nodes[0] + (nodes[1] - nodes[0]) * 0.5;
    const hi = nodes[nodes.length - 2] + (nodes[nodes.length - 1] - nodes[nodes.length - 2]) * 0.5;
    const inBand = xs.filter((p, i) => p.minutesMiss >= lo * pred[i] && p.minutesMiss <= hi * pred[i]).length / xs.length;
    const constant = avg(fit.map((p) => Math.abs(p.minutesMiss)));
    const inBandConst = xs.filter((p) => p.minutesMiss >= lo * constant && p.minutesMiss <= hi * constant).length / xs.length;
    return { corr: r3(corr(pred, real)), deciles, bandCoverage: r3(inBand), bandCoverageConstantScale: r3(inBandConst), nominal: 0.8 };
  };
  emit("MIN_SCALE", {
    coef: Object.fromEntries(MINUTES_FEATURES.map((f, i) => [f, r3(minutesCoef[i])])),
    nodes: nodes.map(r3),
    nodeMean: r3(avg(nodes)),
    fit: scaleCheck(fit),
    check: scaleCheck(check),
  });

  // Per-minute dispersion priors: each stat's median own dispersion on FIT.
  const phi0: Record<string, number> = {};
  for (const key of STATS) {
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    const own = every(fit.filter((p) => p.proj[key]), 6000).map((p) => {
      const played = p.history.filter((l) => l.minutes > 0);
      return perMinuteDispersion(played.map((l) => stat.value(l)), played.map((l) => l.minutes), 1, 0);
    });
    phi0[key] = r3([...own].sort((a, b) => a - b)[Math.floor(own.length / 2)]);
  }
  const fitted: ShadowParams = { ...SHADOW_PARAMS, minutesCoef: minutesCoef.map((c) => Math.round(c * 10000) / 10000), minScale, nodes: nodes.map(r3), phi0 };

  // kappa per stat: the s2 variance multiplier with the best mean log score on a FIT subsample.
  const kappa: Record<string, number> = {};
  for (const key of STATS) {
    const rows = every(fit.filter((p) => p.proj[key]), KAPPA_SAMPLE);
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    let best = { k: 1, ll: -Infinity };
    for (const k of KAPPA_GRID) {
      const params = { ...fitted, kappa: { ...fitted.kappa, [key]: k } };
      const ll = avg(
        rows.map((p) => {
          const m = methodPmf("s2", p, key, params);
          const a = stat.value(p.game);
          return m ? Math.log(Math.max(m.pmf[a] ?? 0, 1e-12)) : NaN;
        }).filter(Number.isFinite)
      );
      if (ll > best.ll) best = { k, ll };
    }
    kappa[key] = best.k;
  }
  fitted.kappa = kappa;
  emit("PARAMS", fitted);

  // ---- 2 & 3. Variance and bias, per stat -----------------------------------
  type Acc = { ll: number[]; brier: number[]; logloss: number[]; z: Map<string, number[]>; zOver: Map<string, { p: number; y: number }[]>; cover: number[]; mean: number[] };
  const fresh = (): Acc => ({ ll: [], brier: [], logloss: [], z: new Map(), zOver: new Map(), cover: [], mean: [] });
  for (const [setName, rowsAll] of [
    ["fit", fit],
    ["check", check],
  ] as const) {
    for (const key of STATS) {
      const stat: NbaPropStatDef = NBA_PROP_STAT_BY_KEY.get(key)!;
      const rows = every(rowsAll.filter((p) => p.proj[key]), Number(process.env.N ?? 12000));
      const acc: Record<string, Acc> = { prod: fresh(), s1: fresh(), s2: fresh() };
      const bias = { n: 0, total: [] as number[], minutesPart: [] as number[], ratePart: [] as number[], bySignedZ: new Map<string, number[]>() };
      for (const p of rows) {
        const proj = p.proj[key]!;
        const actual = stat.value(p.game);
        const l10 = avg(p.history.slice(0, 10).map((l) => stat.value(l)));
        if (l10 < 1) continue;
        const line = Math.round(l10 - 0.5) + 0.5;
        const zProd = (proj.mean - line) / proj.sd;
        const zb = Z_BUCKETS.find(([lo, hi]) => Math.abs(zProd) >= lo && Math.abs(zProd) < hi)!;
        const zKey = `${zb[0]}-${zb[1] === 99 ? "+" : zb[1]}`;
        // Bias decomposition: actual − projection = (minutes miss) × rate + actual minutes × (rate miss).
        const rate = proj.mean / proj.minutes;
        const minutesPart = (p.game.minutes - proj.minutes) * rate;
        bias.total.push(actual - proj.mean);
        bias.minutesPart.push(minutesPart);
        bias.ratePart.push(actual - proj.mean - minutesPart);
        const sz = `${zProd >= 0 ? "proj>line" : "proj<line"} ${zKey}`;
        (bias.bySignedZ.get(sz) ?? bias.bySignedZ.set(sz, []).get(sz)!).push(actual - proj.mean);
        for (const method of ["prod", "s1", "s2"] as const) {
          const m = methodPmf(method, p, key, method === "prod" ? SHADOW_PARAMS : fitted);
          if (!m) continue;
          const a = acc[method];
          a.ll.push(Math.log(Math.max(m.pmf[actual] ?? 0, 1e-12)));
          const over = overOf(m.pmf, line);
          const y = actual > line ? 1 : 0;
          a.brier.push((over - y) ** 2);
          a.logloss.push(-(y * Math.log(over) + (1 - y) * Math.log(1 - over)));
          (a.z.get(zKey) ?? a.z.set(zKey, []).get(zKey)!).push((actual - m.mean) / Math.max(m.sd, 1e-6));
          // The side production leans at this distance: its chance vs how often it came in.
          const sideP = zProd >= 0 ? over : 1 - over;
          const sideY = zProd >= 0 ? y : 1 - y;
          (a.zOver.get(zKey) ?? a.zOver.set(zKey, []).get(zKey)!).push({ p: sideP, y: sideY });
          a.cover.push(actual >= quantileOf(m.pmf, 0.1) && actual <= quantileOf(m.pmf, 0.9) ? 1 : 0);
          a.mean.push(m.mean);
        }
      }
      const summary = (a: Acc) => ({
        logScore: r3(avg(a.ll)),
        brier: Math.round(avg(a.brier) * 10000) / 10000,
        logloss: Math.round(avg(a.logloss) * 10000) / 10000,
        cover80: r3(avg(a.cover)),
        meanProj: r3(avg(a.mean)),
        zResidualSd: Object.fromEntries([...a.z].sort().map(([k, v]) => [k, { n: v.length, sd: r3(sdOf(v)), mean: r3(avg(v)) }])),
        sideCalibration: Object.fromEntries([...a.zOver].sort().map(([k, v]) => [k, { n: v.length, said: r3(avg(v.map((x) => x.p))), won: r3(avg(v.map((x) => x.y))) }])),
      });
      emit("VAR", { set: setName, stat: key, combo: COMBOS.has(key), n: acc.prod.ll.length, prod: summary(acc.prod), s1: summary(acc.s1), s2: summary(acc.s2) });
      emit("BIAS", {
        set: setName,
        stat: key,
        combo: COMBOS.has(key),
        n: bias.total.length,
        actualMinusProj: r3(avg(bias.total)),
        minutesPart: r3(avg(bias.minutesPart)),
        ratePart: r3(avg(bias.ratePart)),
        s1MeanShift: r3(avg(acc.s1.mean) - avg(acc.prod.mean)),
        bySignedZ: Object.fromEntries([...bias.bySignedZ].sort().map(([k, v]) => [k, { n: v.length, bias: r3(avg(v)) }])),
      });
    }
  }

  // ---- 3b. The tracked leans (real lines, Nov 6–16): descriptive only ------
  const leans = (await attachNbaPostGame(await loadGradedLeans(365))).filter(
    (l) => l.features.sport === "nba" && l.features.kind === "prop" && !l.features.alt && l.result !== "void" && typeof l.actual === "number" && typeof l.features.projMean === "number" && (l.features.minutes ?? 0) > 0 && (l.post?.minutes ?? 0) > 0 && l.startsAt < new Date(`${FORWARD_START}T00:00:00Z`)
  );
  const byStat = new Map<string, { total: number[]; minutesPart: number[]; ratePart: number[]; over: number[]; under: number[] }>();
  for (const l of leans) {
    const f = l.features;
    const s = byStat.get(f.stat) ?? byStat.set(f.stat, { total: [], minutesPart: [], ratePart: [], over: [], under: [] }).get(f.stat)!;
    const total = l.actual! - f.projMean!;
    const minutesPart = (l.post!.minutes! - f.minutes!) * (f.projMean! / f.minutes!);
    s.total.push(total);
    s.minutesPart.push(minutesPart);
    s.ratePart.push(total - minutesPart);
    (f.side === "over" ? s.over : s.under).push(total);
  }
  emit("BIAS_LEANS", {
    n: leans.length,
    note: "tracked main-line leans before Nov 17 (the audited sample): descriptive, not used for any fit",
    byStat: Object.fromEntries(
      [...byStat].map(([k, s]) => [
        k,
        { n: s.total.length, combo: COMBOS.has(k), actualMinusProj: r3(avg(s.total)), minutesPart: r3(avg(s.minutesPart)), ratePart: r3(avg(s.ratePart)), overs: { n: s.over.length, bias: r3(avg(s.over)) }, unders: { n: s.under.length, bias: r3(avg(s.under)) } },
      ])
    ),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
