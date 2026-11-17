import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { projectProp, type ProjectionContext, type PropProjection } from "@/lib/nba/projection";
import { SHADOW_PARAMS, minutesFeatures, minutesScale, mixturePmf, nbPmf, ols, perMinuteDispersion, quantileNodes, shadowDistribution, type ShadowParams } from "@/lib/shadow/nbaShadow";
import {
  MINUTES_V2_FEATURES,
  V2_PARAMS,
  baseMinutes,
  correctedOnlyVariance,
  minutesV2,
  minutesV2Features,
  poissonWithOffset,
  rateGap,
  recentAverage,
  v2Distribution,
  v2Projection,
  COMPONENT_VALUE,
  type V2Component,
  type V2Params,
} from "@/lib/shadow/v2";
import { loadNbaReplay, type ReplayLog } from "./props/nbaReplay";

/**
 * Shadow v2 lab (read-only; docs/alpha-sprint.md): the one fit of V2_PARAMS
 * and its chronological holdout.
 *
 *   TRAIN    first 70% of 2025-26 player-games by date: every v2 constant.
 *   HOLDOUT  last 30% of 2025-26: untouched by any fit (v1's constants were
 *            fitted on the whole of 2025-26, so the v1 shadow s2 is in-sample
 *            here and is shown only as a reference).
 *   SEEN     2026-27 before Nov 17: already read by lab:nba-shadow (#103) and
 *            the audits; a second look, labeled as such, never the evidence.
 *   Games from Nov 17 on are never read here.
 *
 * Strictly pregame: production's projection is rebuilt WITHOUT the replay's
 * reconstructed absences (who actually sat that night is postgame knowledge),
 * for every method alike. The reconstructed-absence cut is shown separately
 * and only descriptively.
 *
 * Methods compared on the same rows: prod (production), s2 (v1 shadow),
 * corr (v2's corrected mean under production's spread: the projection fix
 * alone), v2 (corrected mean + v2 distribution).
 *
 * Run: `npm run lab:nba-v2`. Each line is @@TAG@@{json}; PARAMS is V2_PARAMS.
 */
const FORWARD_START = "2026-11-17";
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"] as const;
const COMPONENTS: V2Component[] = ["points", "rebounds", "assists", "threes"];
const KAPPA_GRID = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.3, 2.6];
const KAPPA_SAMPLE = 3000;
const EVAL_SAMPLE = Number(process.env.N ?? 12000);
const Z_BUCKETS: [number, number][] = [
  [0, 0.35],
  [0.35, 0.55],
  [0.55, 0.75],
  [0.75, 1],
  [1, 99],
];

const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sdOf = (xs: number[]) => {
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length - 1, 1));
};
const every = <T>(xs: T[], n: number) => (xs.length <= n ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / n) === 0));

type SetName = "train" | "holdout" | "seen";
interface PG {
  set: SetName;
  game: ReplayLog;
  history: ReplayLog[];
  prod: Partial<Record<(typeof STATS)[number], PropProjection>>;
  nThis: number;
  absent: boolean;
}

function pmfOf(method: "prod" | "s2" | "corr" | "v2", pg: PG, key: (typeof STATS)[number], p: V2Params): { pmf: number[]; mean: number; sd: number } | null {
  const proj = pg.prod[key]!;
  const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
  const span = (m: number, sd: number) => Math.ceil(m + 10 * sd + 10);
  if (method === "prod") {
    const d = proj.distribution;
    if (d.kind !== "count") return null;
    return { pmf: nbPmf(d.mean, d.variance, span(d.mean, Math.sqrt(d.variance))), mean: d.mean, sd: Math.sqrt(d.variance) };
  }
  if (method === "s2") {
    const d = shadowDistribution(proj, pg.history, stat, "s2", SHADOW_PARAMS);
    if (!d) return null;
    return { pmf: mixturePmf(d, span(d.mean, d.sd * 2)), mean: d.mean, sd: d.sd };
  }
  const v = v2Projection(key, pg.prod, pg.history, pg.game.season, p);
  if (!v) return null;
  if (method === "corr") {
    const variance = correctedOnlyVariance(proj, v.mean);
    return { pmf: nbPmf(v.mean, variance, span(v.mean, Math.sqrt(variance))), mean: v.mean, sd: Math.sqrt(variance) };
  }
  const d = v2Distribution(v, proj, pg.history, stat, p);
  if (!d) return null;
  return { pmf: mixturePmf(d, span(d.mean, d.sd * 2)), mean: d.mean, sd: d.sd };
}

const overOf = (pmf: number[], line: number) => {
  let below = 0;
  for (let k = 0; k <= Math.floor(line) && k < pmf.length; k++) below += pmf[k];
  return Math.min(Math.max(1 - below, 1e-6), 1 - 1e-6);
};
const quantileOf = (pmf: number[], q: number) => {
  let c = 0;
  for (let k = 0; k < pmf.length; k++) if ((c += pmf[k]) >= q) return k;
  return pmf.length - 1;
};

async function main() {
  const replay = await loadNbaReplay();
  const seasons = [...new Set([...replay.byPlayer.values()].flatMap((g) => g.map((l) => l.season)))].sort((a, b) => a - b);
  const current = seasons[seasons.length - 1];
  const trainSeason = seasons[seasons.length - 2];

  // ---- The replay (pregame only: no reconstructed absences) -----------------
  const raw: Omit<PG, "set">[] = [];
  for (const games of replay.byPlayer.values()) {
    for (let i = 10; i < games.length; i++) {
      const game = games[i];
      if (game.date >= FORWARD_START || (game.season !== trainSeason && game.season !== current)) continue;
      const history = games.slice(0, i).reverse();
      const full = replay.contextFor(game);
      const ctx: ProjectionContext = { ...full, absences: [], opponentAbsences: [] };
      const prod: PG["prod"] = {};
      for (const key of STATS) {
        const p = projectProp(history, NBA_PROP_STAT_BY_KEY.get(key)!, ctx);
        if (p && p.sd > 0 && p.minutes > 0) prod[key] = p;
      }
      if (!prod.points) continue;
      raw.push({ game, history, prod, nThis: history.filter((l) => l.season === game.season).length, absent: (full.absences?.length ?? 0) > 0 });
    }
  }
  const trainDates = raw.filter((r) => r.game.season === trainSeason).map((r) => r.game.date).sort();
  const cutoff = trainDates[Math.floor(trainDates.length * 0.7)];
  const pgs: PG[] = raw.map((r) => ({ ...r, set: r.game.season === current ? "seen" : r.game.date < cutoff ? "train" : "holdout" }));
  const bySet = (s: SetName) => pgs.filter((p) => p.set === s);
  const train = bySet("train");
  emit("SETUP", {
    trainSeason,
    currentSeason: current,
    cutoff,
    train: train.length,
    holdout: bySet("holdout").length,
    seen: bySet("seen").length,
    games: Object.fromEntries((["train", "holdout", "seen"] as const).map((s) => [s, new Set(bySet(s).map((p) => p.game.gameId)).size])),
    note: "reconstructed absences are excluded from every projection here (postgame knowledge)",
  });

  // ---- 1. Minutes v2 -----------------------------------------------------------
  const params: V2Params = { ...V2_PARAMS };
  const base = (pg: PG) => baseMinutes(pg.prod.points!);
  const minutesCoef = ols(
    train.map((pg) => minutesV2Features(pg.prod.points!, pg.history, pg.game.season, params)),
    train.map((pg) => pg.game.minutes - base(pg))
  );
  params.minutesCoef = minutesCoef.map((c) => Math.round(c * 10000) / 10000);
  const m2 = (pg: PG) => minutesV2(pg.prod.points!, pg.history, pg.game.season, params);

  // Minutes uncertainty, refitted around minutes v2: the v1 miss-scale features with projMinutes = v2.
  const pseudo = (pg: PG) => ({ ...pg.prod.points!, minutes: m2(pg) });
  const scaleCoef = ols(
    train.map((pg) => minutesFeatures(pseudo(pg), pg.history)),
    train.map((pg) => Math.abs(pg.game.minutes - m2(pg)))
  );
  const scaleParams: ShadowParams = { ...SHADOW_PARAMS, minutesCoef: scaleCoef.map((c) => Math.round(c * 10000) / 10000) };
  const scaleOf = (pg: PG) => minutesScale(minutesFeatures(pseudo(pg), pg.history), scaleParams);
  const nodes = quantileNodes(
    train.map((pg) => (pg.game.minutes - m2(pg)) / scaleOf(pg)),
    SHADOW_PARAMS.nodes.length
  ).map((x) => Math.round(x * 1000) / 1000);

  // ---- 2. Per-minute rate, per component (offset: actual minutes × production's rate) ----
  for (const c of COMPONENTS) {
    const rows = train
      .filter((pg) => pg.prod[c] && pg.game.minutes > 0)
      .map((pg) => {
        const rate = pg.prod[c]!.mean / pg.prod[c]!.minutes;
        return { y: COMPONENT_VALUE[c](pg.game), offset: Math.log(Math.max(pg.game.minutes * rate, 1e-6)), x: [1, rateGap(rate, pg.history, pg.game.season, c, params)] };
      });
    const fit = poissonWithOffset(rows) ?? [0, 0];
    params.rate = { ...params.rate, [c]: { a: Math.round(fit[0] * 10000) / 10000, b: Math.round(fit[1] * 10000) / 10000 } };
  }

  // ---- 3. Displacement γ per component (after minutes and rate) ---------------
  for (const c of COMPONENTS) {
    let sxy = 0;
    let sxx = 0;
    for (const pg of train) {
      const pc = pg.prod[c];
      if (!pc) continue;
      const rate = pc.mean / pc.minutes;
      const k = params.rate[c];
      const afterRate = m2(pg) * rate * Math.exp(k.a + k.b * rateGap(rate, pg.history, pg.game.season, c, params));
      const b = recentAverage(pg.history, c, params.baseGames);
      sxy += (afterRate - b) * (COMPONENT_VALUE[c](pg.game) - b);
      sxx += (afterRate - b) ** 2;
    }
    params.gamma = { ...params.gamma, [c]: sxx > 0 ? Math.round((sxy / sxx) * 1000) / 1000 : 1 };
  }

  // ---- 4. Distribution: dispersion priors, κ, and whether the minutes mixture helps (TRAIN only) ----
  const phi0: Record<string, number> = {};
  for (const key of STATS) {
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    const own = every(train, 6000).map((pg) => {
      const played = pg.history.filter((l) => l.minutes > 0);
      return perMinuteDispersion(played.map((l) => stat.value(l)), played.map((l) => l.minutes), 1, 0);
    });
    phi0[key] = Math.round([...own].sort((a, b) => a - b)[Math.floor(own.length / 2)] * 1000) / 1000;
  }
  const choose = (mixture: boolean) => {
    const kappa: Record<string, number> = {};
    let total = 0;
    for (const key of STATS) {
      const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
      const rows = every(train.filter((pg) => pg.prod[key]), KAPPA_SAMPLE);
      let best = { k: 1, ll: -Infinity };
      for (const k of KAPPA_GRID) {
        const p: V2Params = { ...params, minutesMixture: mixture, dist: { ...SHADOW_PARAMS, minutesCoef: scaleParams.minutesCoef, nodes, phi0, kappa: { ...SHADOW_PARAMS.kappa, [key]: k } } };
        const ll = avg(rows.map((pg) => pmfOf("v2", pg, key, p)).map((m, i) => (m ? Math.log(Math.max(m.pmf[stat.value(rows[i].game)] ?? 0, 1e-12)) : NaN)).filter(Number.isFinite));
        if (ll > best.ll) best = { k, ll };
      }
      kappa[key] = best.k;
      total += best.ll;
    }
    return { kappa, total };
  };
  const withMix = choose(true);
  const noMix = choose(false);
  params.minutesMixture = withMix.total >= noMix.total;
  params.dist = { ...SHADOW_PARAMS, minutesCoef: scaleParams.minutesCoef, nodes, phi0, kappa: params.minutesMixture ? withMix.kappa : noMix.kappa };
  emit("MIXTURE_CHOICE", { trainLogScoreSum: { withMinutesMixture: r4(withMix.total), singleMinutesNode: r4(noMix.total) }, chosen: params.minutesMixture ? "mixture" : "single node" });
  emit("PARAMS", params);

  // ---- 5. Evaluation, per set ---------------------------------------------------
  const groups: Record<string, (pg: PG) => boolean> = {
    all: () => true,
    "proj 35+": (pg) => base(pg) >= 35,
    "proj 30-35": (pg) => base(pg) >= 30 && base(pg) < 35,
    "proj <22": (pg) => base(pg) < 22,
    "early season (<10 this season)": (pg) => pg.nThis < 10,
    bench: (pg) => pg.prod.points!.minutesDetail?.role === "bench",
    starter: (pg) => pg.prod.points!.minutesDetail?.role === "starter",
    returning: (pg) => (pg.prod.points!.minutesDetail?.missed ?? 0) >= 1,
    "volatile (sd10 7+)": (pg) => minutesV2Features(pg.prod.points!, pg.history, pg.game.season, params)[MINUTES_V2_FEATURES.indexOf("sd10")] >= 7,
    "teammates out (reconstructed, descriptive)": (pg) => pg.absent,
  };
  for (const set of ["train", "holdout", "seen"] as const) {
    const rows = bySet(set);
    const out: Record<string, unknown> = {};
    for (const [g, f] of Object.entries(groups)) {
      const r = rows.filter(f);
      if (r.length < 30) continue;
      const prodMiss = r.map((pg) => pg.game.minutes - pg.prod.points!.minutes);
      const v2Miss = r.map((pg) => pg.game.minutes - m2(pg));
      const scale = r.map(scaleOf);
      const lo = nodes[0] + (nodes[1] - nodes[0]) / 2;
      const hi = nodes[nodes.length - 2] + (nodes[nodes.length - 1] - nodes[nodes.length - 2]) / 2;
      out[g] = {
        n: r.length,
        prod: { bias: r3(avg(prodMiss)), mae: r3(avg(prodMiss.map(Math.abs))) },
        v2: { bias: r3(avg(v2Miss)), mae: r3(avg(v2Miss.map(Math.abs))) },
        band80: r3(r.filter((_, i) => v2Miss[i] >= lo * scale[i] && v2Miss[i] <= hi * scale[i]).length / r.length),
      };
    }
    emit("MINUTES", { set, groups: out });
  }

  for (const set of ["train", "holdout", "seen"] as const) {
    for (const key of STATS) {
      const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
      const rows = every(bySet(set).filter((pg) => pg.prod[key]), EVAL_SAMPLE);
      type Acc = { ll: number[]; brier: number[]; logloss: number[]; cover: number[]; z: Map<string, number[]>; side: Map<string, { p: number; y: number }[]> };
      const acc: Record<string, Acc> = {};
      for (const m of ["prod", "s2", "corr", "v2"]) acc[m] = { ll: [], brier: [], logloss: [], cover: [], z: new Map(), side: new Map() };
      // Mean accuracy by stage, and by group (does any group get worse?).
      const stage = { prod: [] as number[], minutes: [] as number[], rate: [] as number[], v2: [] as number[] };
      const byGroup = new Map<string, { prod: number[]; v2: number[] }>();
      for (const pg of rows) {
        const proj = pg.prod[key]!;
        const actual = stat.value(pg.game);
        const v = v2Projection(key, pg.prod, pg.history, pg.game.season, params);
        if (!v) continue;
        stage.prod.push(actual - proj.mean);
        stage.minutes.push(actual - v.components.reduce((a, c) => a + c.afterMinutes, 0));
        stage.rate.push(actual - v.components.reduce((a, c) => a + c.afterRate, 0));
        stage.v2.push(actual - v.mean);
        for (const [g, f] of Object.entries(groups)) {
          if (g === "all" || !f(pg)) continue;
          const e = byGroup.get(g) ?? byGroup.set(g, { prod: [], v2: [] }).get(g)!;
          e.prod.push(actual - proj.mean);
          e.v2.push(actual - v.mean);
        }
        const l10 = avg(pg.history.slice(0, 10).map((l) => stat.value(l)));
        if (l10 < 1) continue;
        const line = Math.round(l10 - 0.5) + 0.5;
        const zProd = (proj.mean - line) / proj.sd;
        const zb = Z_BUCKETS.find(([lo, hi]) => Math.abs(zProd) >= lo && Math.abs(zProd) < hi)!;
        const zKey = `${zb[0]}-${zb[1] === 99 ? "+" : zb[1]}`;
        const y = actual > line ? 1 : 0;
        for (const m of ["prod", "s2", "corr", "v2"] as const) {
          const d = pmfOf(m, pg, key, params);
          if (!d) continue;
          const a = acc[m];
          const over = overOf(d.pmf, line);
          a.ll.push(Math.log(Math.max(d.pmf[actual] ?? 0, 1e-12)));
          a.brier.push((over - y) ** 2);
          a.logloss.push(-(y * Math.log(over) + (1 - y) * Math.log(1 - over)));
          a.cover.push(actual >= quantileOf(d.pmf, 0.1) && actual <= quantileOf(d.pmf, 0.9) ? 1 : 0);
          (a.z.get(zKey) ?? a.z.set(zKey, []).get(zKey)!).push((actual - d.mean) / Math.max(d.sd, 1e-6));
          (a.side.get(zKey) ?? a.side.set(zKey, []).get(zKey)!).push({ p: zProd >= 0 ? over : 1 - over, y: zProd >= 0 ? y : 1 - y });
        }
      }
      const summary = (a: Acc) => ({
        n: a.ll.length,
        logScore: r4(avg(a.ll)),
        brier: r4(avg(a.brier)),
        logloss: r4(avg(a.logloss)),
        cover80: r3(avg(a.cover)),
        zSd: Object.fromEntries([...a.z].sort().map(([k, v]) => [k, r3(sdOf(v))])),
        side: Object.fromEntries([...a.side].sort().map(([k, v]) => [k, { n: v.length, said: r3(avg(v.map((x) => x.p))), won: r3(avg(v.map((x) => x.y))) }])),
      });
      emit("DIST", { set, stat: key, prod: summary(acc.prod), s2: summary(acc.s2), corr: summary(acc.corr), v2: summary(acc.v2) });
      emit("MEAN", {
        set,
        stat: key,
        n: stage.prod.length,
        bias: { prod: r3(avg(stage.prod)), afterMinutes: r3(avg(stage.minutes)), afterRate: r3(avg(stage.rate)), v2: r3(avg(stage.v2)) },
        mae: { prod: r3(avg(stage.prod.map(Math.abs))), afterMinutes: r3(avg(stage.minutes.map(Math.abs))), afterRate: r3(avg(stage.rate.map(Math.abs))), v2: r3(avg(stage.v2.map(Math.abs))) },
        groups: Object.fromEntries(
          [...byGroup].map(([g, e]) => [g, { n: e.prod.length, prodBias: r3(avg(e.prod)), v2Bias: r3(avg(e.v2)), prodMae: r3(avg(e.prod.map(Math.abs))), v2Mae: r3(avg(e.v2.map(Math.abs))) }])
        ),
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
