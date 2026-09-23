import { fetchNflGames } from "@/lib/nfl/games";
import { franchise } from "@/lib/nfl/pbp/franchise";
import { loadPlayerGames, type PlayerGame } from "@/lib/nfl/props/playerGames";
import { walkForward, type EngineParams, type GameContext, type Snapshot } from "@/lib/nfl/props/engine";
import {
  PROP_MARKETS, actualFor, components, oppFactors, project, volumeFeatures,
  type ModelParams, type PropMarket, type ShrinkParams, type SnapshotSet, type VolumeCoefs,
} from "@/lib/nfl/props/model";
import { LogisticCalibrator, RatioDistribution } from "@/lib/nfl/props/distribution";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readManifest } from "@/lib/nfl/nflverse";
import { NFL_PROPS_MODEL_KEY, NFL_PROPS_MODEL_VERSION, type FrozenModelFile, type ValidationRow } from "@/lib/nfl/props/frozen";
import { EligibilityTracker, MARKET_FAMILY, type Baseline, type PropFamily } from "@/lib/nfl/props/eligibility";

/**
 * NFL player-prop projection experiment — volume × share × efficiency model vs.
 * the naive baselines every props app shows (season average, last-5 average).
 *
 * Splits (by season): warm-up 2013 (snap counts start here), train 2014–2019,
 * validation 2020–2022, test 2023–2025 SEALED (NFL_OPEN_TEST=1, once, after the
 * model is frozen). Every hyperparameter — decay half-lives, shrinkage
 * strengths, team-volume coefficients, opponent-adjustment damping, the
 * outcome distribution — is fit on train only.
 *
 * There is no free archive of historical NFL prop odds, so this measures
 * projection quality against outcomes, not betting edge. Beating naive
 * baselines is necessary, not sufficient; edge needs live lines (forward
 * capture).
 *
 * Run: `npm run experiment:nfl:props`
 */

const FIRST = 2013;
const TRAIN = [2014, 2019] as const;
const VALID = [2020, 2022] as const;
const TEST = [2023, 2025] as const;
const OPEN_TEST = process.env.NFL_OPEN_TEST === "1";
const BOOT = 1000;

const HALF_LIVES = [4, 8, 16];
const CARRIES = [0.5, 1];
const K_GRID = [1, 3, 10, 30, 100, 300];

const LINE_GRID: Record<PropMarket, number[]> = {
  receptions: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  receivingYards: [14.5, 24.5, 34.5, 44.5, 54.5, 64.5, 74.5, 84.5, 94.5],
  rushAttempts: [7.5, 9.5, 11.5, 13.5, 15.5, 17.5, 19.5],
  rushingYards: [29.5, 39.5, 49.5, 59.5, 69.5, 79.5, 89.5, 99.5],
  passAttempts: [27.5, 29.5, 31.5, 33.5, 35.5, 37.5, 39.5],
  completions: [17.5, 19.5, 21.5, 23.5, 25.5],
  passingYards: [184.5, 204.5, 224.5, 244.5, 264.5, 284.5],
};

const inRange = (season: number, [a, b]: readonly [number, number]) => season >= a && season <= b;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

// ─── baselines & eligibility (model-independent, pregame; shared with the live projector) ──
type Family = PropFamily;
const FAMILY = MARKET_FAMILY;

function computeBaselines(players: readonly PlayerGame[]): Map<PlayerGame, Baseline> {
  const sorted = [...players].sort((a, b) => a.season - b.season || a.week - b.week);
  const tracker = new EligibilityTracker();
  const out = new Map<PlayerGame, Baseline>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].season === sorted[i].season && sorted[j].week === sorted[i].week) j++;
    const wk = sorted.slice(i, j);
    for (const pg of wk) out.set(pg, tracker.baseline(pg));
    tracker.foldWeek(wk);
    i = j;
  }
  return out;
}

// ─── fitting helpers ───────────────────────────────────────────────────────
function ols(X: readonly number[][], y: readonly number[]): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++)
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) A[r][c] += X[i][r] * X[i][c];
      A[r][p] += X[i][r] * y[i];
    }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / row[i]);
}

type ComponentKey = keyof ShrinkParams;
/** Each shrinkage component: which family's rows fit it, its observed rate, and its weight. */
const COMPONENT_SPEC: Record<ComponentKey, { group: "usage" | "efficiency"; family: Family; comp: keyof ReturnType<typeof components>; y: (s: Snapshot, team: TeamVol) => [number, number] }> = {
  kTgtShare: { group: "usage", family: "rec", comp: "tgtShare", y: (s, t) => [s.pg.targets, t.targets] },
  kCarShare: { group: "usage", family: "rush", comp: "carShare", y: (s, t) => [s.pg.carries, t.carries] },
  kAttShare: { group: "usage", family: "pass", comp: "attShare", y: (s, t) => [s.pg.passAttempts, t.passAttempts] },
  kCatch: { group: "efficiency", family: "rec", comp: "catchRate", y: (s) => [s.pg.receptions, s.pg.targets] },
  kYpt: { group: "efficiency", family: "rec", comp: "ypt", y: (s) => [s.pg.receivingYards, s.pg.targets] },
  kYpc: { group: "efficiency", family: "rush", comp: "ypc", y: (s) => [s.pg.rushingYards, s.pg.carries] },
  kCmp: { group: "efficiency", family: "pass", comp: "cmpRate", y: (s) => [s.pg.completions, s.pg.passAttempts] },
  kYpa: { group: "efficiency", family: "pass", comp: "ypa", y: (s) => [s.pg.passingYards, s.pg.passAttempts] },
};

interface TeamVol {
  targets: number;
  carries: number;
  passAttempts: number;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log("NFL player-prop projection experiment\n");
  const games = await fetchNflGames();
  const ctx = new Map<string, GameContext>(
    games.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }])
  );
  console.log("Loading weekly player stats + snap counts…");
  const { players, teams } = await loadPlayerGames(FIRST, TEST[1]);
  const teamVol = new Map(teams.map((t) => [`${t.gameId}|${t.team}`, t]));
  const baselines = computeBaselines(players);
  console.log(`  ${players.length} skill player-games, ${teams.length} team-games\n`);

  // 1. walk history once per (half-life, season carry); snapshot order is identical across passes
  const passes: { params: EngineParams; snaps: Snapshot[] }[] = [];
  for (const halfLife of HALF_LIVES)
    for (const seasonCarry of CARRIES) {
      const snaps: Snapshot[] = [];
      walkForward(players, teams, ctx, { halfLife, seasonCarry }, (s) => snaps.push(s));
      passes.push({ params: { halfLife, seasonCarry }, snaps });
    }
  const N = passes[0].snaps.length;
  const idxAll = [...Array(N).keys()];
  const pgAt = (i: number) => passes[0].snaps[i].pg;
  const tv = (i: number) => teamVol.get(`${pgAt(i).gameId}|${pgAt(i).team}`)!;
  const elig = (i: number, fam: Family) => baselines.get(pgAt(i))!.eligible[fam];
  const trainIdx = idxAll.filter((i) => inRange(pgAt(i).season, TRAIN));

  // 2. shrinkage components: per group pick one pass (normalized loss), then k per component
  const shrinkFit = {} as ShrinkParams;
  const groupPass: Record<"usage" | "efficiency", number> = { usage: 0, efficiency: 0 };
  console.log("Fitting shrinkage on train (weighted MSE of each rate):");
  for (const group of ["usage", "efficiency"] as const) {
    const comps = (Object.keys(COMPONENT_SPEC) as ComponentKey[]).filter((c) => COMPONENT_SPEC[c].group === group);
    const lossTable = comps.map((c) => {
      const spec = COMPONENT_SPEC[c];
      const rows = trainIdx.filter((i) => elig(i, spec.family));
      return passes.map((pass) =>
        K_GRID.map((k) => {
          let se = 0;
          let w = 0;
          const p: ShrinkParams = { ...shrinkFitDefaults(), [c]: k };
          for (const i of rows) {
            const s = pass.snaps[i];
            const [num, den] = spec.y(s, tv(i));
            if (den <= 0) continue;
            const pred = components({ usage: s, efficiency: s }, p)[spec.comp];
            se += den * (num / den - pred) ** 2;
            w += den;
          }
          return se / w;
        })
      );
    });
    // normalized: each component's best-k loss per pass / its best over all passes
    let bestPass = 0;
    let bestScore = Infinity;
    passes.forEach((_, pi) => {
      const score = lossTable.reduce((sum, perPass) => {
        const best = Math.min(...perPass.flat());
        return sum + Math.min(...perPass[pi]) / best;
      }, 0);
      if (score < bestScore) {
        bestScore = score;
        bestPass = pi;
      }
    });
    groupPass[group] = bestPass;
    comps.forEach((c, ci) => {
      const row = lossTable[ci][bestPass];
      shrinkFit[c] = K_GRID[row.indexOf(Math.min(...row))];
    });
    const pp = passes[bestPass].params;
    console.log(`  ${group.padEnd(10)} half-life ${pp.halfLife} games, season carry ${pp.seasonCarry}; ` + comps.map((c) => `${c}=${shrinkFit[c]}`).join(", "));
  }

  // 3. team volume: OLS per pass on train team-games, pick pass by summed normalized MSE
  const teamRowIdx = new Map<string, number>();
  for (const i of trainIdx) {
    const key = `${pgAt(i).gameId}|${pgAt(i).team}`;
    if (!teamRowIdx.has(key)) teamRowIdx.set(key, i);
  }
  const teamRows = [...teamRowIdx.values()];
  let volume = { tgt: [0, 0, 0, 0, 0] as VolumeCoefs, car: [0, 0, 0, 0, 0] as VolumeCoefs, att: [0, 0, 0, 0, 0] as VolumeCoefs };
  let teamPass = 0;
  {
    const results = passes.map((pass) => {
      const fit = (kind: "tgt" | "car" | "att", y: (t: TeamVol) => number) => {
        const X = teamRows.map((i) => volumeFeatures(pass.snaps[i], kind));
        const Y = teamRows.map((i) => y(tv(i)));
        const b = ols(X, Y) as VolumeCoefs;
        const mse = mean(X.map((x, r) => (Y[r] - x.reduce((s, v, c) => s + v * b[c], 0)) ** 2));
        return { b, mse };
      };
      return { tgt: fit("tgt", (t) => t.targets), car: fit("car", (t) => t.carries), att: fit("att", (t) => t.passAttempts) };
    });
    const minOf = (k: "tgt" | "car" | "att") => Math.min(...results.map((r) => r[k].mse));
    let best = Infinity;
    results.forEach((r, pi) => {
      const score = r.tgt.mse / minOf("tgt") + r.car.mse / minOf("car") + r.att.mse / minOf("att");
      if (score < best) {
        best = score;
        teamPass = pi;
      }
    });
    const r = results[teamPass];
    volume = { tgt: r.tgt.b, car: r.car.b, att: r.att.b };
    const fmt = (b: number[]) => `[${b.map((x) => x.toFixed(3)).join(", ")}]`;
    console.log(
      `  team vol   half-life ${passes[teamPass].params.halfLife}, carry ${passes[teamPass].params.seasonCarry}; ` +
        `coefs [1, team/g, opp allowed/g, spread, total]: tgt ${fmt(r.tgt.b)} RMSE ${Math.sqrt(r.tgt.mse).toFixed(2)}; ` +
        `car ${fmt(r.car.b)} RMSE ${Math.sqrt(r.car.mse).toFixed(2)}; att ${fmt(r.att.b)} RMSE ${Math.sqrt(r.att.mse).toFixed(2)}`
    );
  }

  // 4. opponent adjustment: grid kDef × γ per family, pick defense pass
  const K_DEF = [30, 100, 300, 1000];
  const GAMMA = [0, 0.25, 0.5, 0.75, 1];
  let oppParams = { kDef: 100, gammaRec: 0, gammaRush: 0, gammaPass: 0 };
  let defPass = 0;
  {
    const effSnaps = passes[groupPass.efficiency].snaps;
    const famRows = {
      rec: trainIdx.filter((i) => elig(i, "rec")),
      rush: trainIdx.filter((i) => elig(i, "rush")),
      pass: trainIdx.filter((i) => elig(i, "pass")),
    };
    const effOf = (i: number) => components({ usage: effSnaps[i], efficiency: effSnaps[i] }, shrinkFit);
    const effCache = new Map<number, ReturnType<typeof components>>();
    const eff = (i: number) => effCache.get(i) ?? effCache.set(i, effOf(i)).get(i)!;
    let bestScore = Infinity;
    const baseLoss: Record<Family, number> = { rec: Infinity, rush: Infinity, pass: Infinity };
    const table: { pi: number; kDef: number; loss: Record<Family, number[]> }[] = [];
    passes.forEach((pass, pi) => {
      for (const kDef of K_DEF) {
        const loss: Record<Family, number[]> = { rec: [], rush: [], pass: [] };
        for (const g of GAMMA) {
          const o = { kDef, gammaRec: g, gammaRush: g, gammaPass: g };
          let rec = 0, rush = 0, pas = 0;
          for (const i of famRows.rec) rec += (pgAt(i).receivingYards - pgAt(i).targets * eff(i).ypt * oppFactors(pass.snaps[i], o).rec) ** 2;
          for (const i of famRows.rush) rush += (pgAt(i).rushingYards - pgAt(i).carries * eff(i).ypc * oppFactors(pass.snaps[i], o).rush) ** 2;
          for (const i of famRows.pass) pas += (pgAt(i).passingYards - pgAt(i).passAttempts * eff(i).ypa * oppFactors(pass.snaps[i], o).pass) ** 2;
          loss.rec.push(rec);
          loss.rush.push(rush);
          loss.pass.push(pas);
        }
        for (const f of ["rec", "rush", "pass"] as Family[]) baseLoss[f] = Math.min(baseLoss[f], ...loss[f]);
        table.push({ pi, kDef, loss });
      }
    });
    for (const row of table) {
      const score = (["rec", "rush", "pass"] as Family[]).reduce((s, f) => s + Math.min(...row.loss[f]) / baseLoss[f], 0);
      if (score < bestScore) {
        bestScore = score;
        defPass = row.pi;
        const g = (f: Family) => GAMMA[row.loss[f].indexOf(Math.min(...row.loss[f]))];
        oppParams = { kDef: row.kDef, gammaRec: g("rec"), gammaRush: g("rush"), gammaPass: g("pass") };
      }
    }
    console.log(
      `  opponent   half-life ${passes[defPass].params.halfLife}, carry ${passes[defPass].params.seasonCarry}; kDef=${oppParams.kDef}, ` +
        `γ rec=${oppParams.gammaRec} rush=${oppParams.gammaRush} pass=${oppParams.gammaPass}`
    );
  }

  const params: ModelParams = { shrink: shrinkFit, opp: oppParams, volume };
  const setAt = (i: number): SnapshotSet => ({
    usage: passes[groupPass.usage].snaps[i],
    efficiency: passes[groupPass.efficiency].snaps[i],
    team: passes[teamPass].snaps[i],
    defense: passes[defPass].snaps[i],
  });
  const proj = idxAll.map((i) => project(setAt(i), params));

  // 5. distributions (train only) for model and both baselines
  type Source = "model" | "seasonAvg" | "l5Avg";
  const SOURCES: Source[] = ["model", "seasonAvg", "l5Avg"];
  const muOf = (i: number, m: PropMarket, src: Source): number | null => {
    if (src === "model") return proj[i][m];
    const b = baselines.get(pgAt(i))![src];
    return b ? b[m] : null;
  };
  const rowsFor = (m: PropMarket, range: readonly [number, number]) =>
    idxAll.filter((i) => inRange(pgAt(i).season, range) && elig(i, FAMILY[m]) && SOURCES.every((s) => muOf(i, m, s) !== null));
  const dists = new Map<string, RatioDistribution>();
  for (const m of PROP_MARKETS)
    for (const src of SOURCES)
      dists.set(`${m}|${src}`, RatioDistribution.fit(rowsFor(m, TRAIN).map((i) => ({ mu: muOf(i, m, src)!, y: actualFor(passes[0].snaps[i], m) }))));

  // 5b. logistic recalibration per family, fit on train at realistic (book-proxy) lines
  const proxyLine = (i: number, m: PropMarket) => Math.floor(muOf(i, m, "seasonAvg")!) + 0.5;
  const calibrators = new Map<string, LogisticCalibrator>();
  for (const fam of ["rec", "rush", "pass"] as Family[])
    for (const src of SOURCES) {
      const pairs = PROP_MARKETS.filter((m) => FAMILY[m] === fam).flatMap((m) =>
        rowsFor(m, TRAIN).map((i) => {
          const L = proxyLine(i, m);
          return { p: dists.get(`${m}|${src}`)!.pOver(muOf(i, m, src)!, L), y: (actualFor(passes[0].snaps[i], m) > L ? 1 : 0) as 0 | 1 };
        })
      );
      calibrators.set(`${fam}|${src}`, LogisticCalibrator.fit(pairs));
    }
  console.log(
    "  calibration σ(a + b·logit p): " +
      (["rec", "rush", "pass"] as Family[]).map((f) => { const c = calibrators.get(`${f}|model`)!; return `${f} a=${c.a.toFixed(3)} b=${c.b.toFixed(3)}`; }).join(", ")
  );
  const prob = (m: PropMarket, src: Source, i: number, L: number) =>
    calibrators.get(`${FAMILY[m]}|${src}`)!.apply(dists.get(`${m}|${src}`)!.pOver(muOf(i, m, src)!, L));

  // 6. evaluate
  const evaluate = (label: string, range: readonly [number, number]): ValidationRow[] => {
    const results: ValidationRow[] = [];
    console.log(`\n── ${label} ──`);
    console.log(
      "  market          n     MAE model / season / L5      Brier@book-proxy line: model / season / L5   Δ(model−season) 95% CI     grid Brier model / season / L5"
    );
    for (const m of PROP_MARKETS) {
      const rows = rowsFor(m, range);
      const y = (i: number) => actualFor(passes[0].snaps[i], m);
      const mae = (src: Source) => mean(rows.map((i) => Math.abs(y(i) - muOf(i, m, src)!)));
      // book-proxy line: the season-average rounded to the nearest half-point below — a line every naive app would show
      const line = (i: number) => Math.floor(muOf(i, m, "seasonAvg")!) + 0.5;
      const brierAt = (src: Source, i: number, L: number) => {
        const p = prob(m, src, i, L);
        return (p - (y(i) > L ? 1 : 0)) ** 2;
      };
      const proxy = (src: Source) => mean(rows.map((i) => brierAt(src, i, line(i))));
      const grid = (src: Source) => mean(rows.flatMap((i) => LINE_GRID[m].map((L) => brierAt(src, i, L))));
      // week-block bootstrap of Δ proxy Brier (model − season)
      const byWeek = new Map<string, number[]>();
      for (const i of rows) {
        const wk = `${pgAt(i).season}_${pgAt(i).week}`;
        (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(brierAt("model", i, line(i)) - brierAt("seasonAvg", i, line(i)));
      }
      const weeks = [...byWeek.values()];
      const rand = rng(20260923);
      const deltas: number[] = [];
      for (let b = 0; b < BOOT; b++) {
        const d: number[] = [];
        for (let j = 0; j < weeks.length; j++) d.push(...weeks[Math.floor(rand() * weeks.length)]);
        deltas.push(mean(d));
      }
      deltas.sort((a, b) => a - b);
      results.push({
        market: m, n: rows.length, maeModel: mae("model"), maeSeasonAvg: mae("seasonAvg"),
        brierModel: proxy("model"), brierSeasonAvg: proxy("seasonAvg"),
        deltaLo: deltas[Math.floor(0.025 * BOOT)], deltaHi: deltas[Math.floor(0.975 * BOOT)],
      });
      const f = (x: number, dp = 4) => x.toFixed(dp);
      console.log(
        `  ${m.padEnd(15)} ${String(rows.length).padStart(5)}  ${f(mae("model"), 2).padStart(6)} / ${f(mae("seasonAvg"), 2).padStart(6)} / ${f(mae("l5Avg"), 2).padStart(6)}      ` +
          `${f(proxy("model"))} / ${f(proxy("seasonAvg"))} / ${f(proxy("l5Avg"))}              ` +
          `${f(proxy("model") - proxy("seasonAvg"))} [${f(deltas[Math.floor(0.025 * BOOT)])}, ${f(deltas[Math.floor(0.975 * BOOT)])}]   ` +
          `${f(grid("model"))} / ${f(grid("seasonAvg"))} / ${f(grid("l5Avg"))}`
      );
    }
    // calibration of model probabilities at proxy lines, pooled across markets
    const bins = Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 }));
    for (const m of PROP_MARKETS)
      for (const i of rowsFor(m, range)) {
        const L = Math.floor(muOf(i, m, "seasonAvg")!) + 0.5;
        const p = prob(m, "model", i, L);
        const b = bins[Math.min(9, Math.floor(p * 10))];
        b.p += p;
        b.y += actualFor(passes[0].snaps[i], m) > L ? 1 : 0;
        b.n++;
      }
    console.log("  model calibration at proxy lines (pooled): " + bins.filter((b) => b.n > 0).map((b) => `${(b.p / b.n).toFixed(2)}→${(b.y / b.n).toFixed(2)} (n=${b.n})`).join("  "));
    return results;
  };

  evaluate("TRAIN 2014–2019 (in-sample fit, context only)", TRAIN);
  const validation = evaluate("VALIDATION 2020–2022", VALID);
  if (OPEN_TEST) evaluate("TEST 2023–2025 — opened once, per pre-registration", TEST);
  else console.log("\nTest window 2023–2025 remains sealed (NFL_OPEN_TEST=1 once the model is frozen).");

  if (process.env.NFL_PROPS_FREEZE === "1") {
    const round = (x: number) => +x.toFixed(6);
    const file: FrozenModelFile = {
      modelKey: NFL_PROPS_MODEL_KEY,
      modelVersion: NFL_PROPS_MODEL_VERSION,
      frozenAt: new Date().toISOString(),
      splits: { train: [...TRAIN], validation: [...VALID], test: [...TEST] },
      engine: {
        usage: passes[groupPass.usage].params,
        efficiency: passes[groupPass.efficiency].params,
        team: passes[teamPass].params,
        defense: passes[defPass].params,
      },
      params: {
        shrink: params.shrink,
        opp: params.opp,
        volume: {
          tgt: params.volume.tgt.map(round) as VolumeCoefs,
          car: params.volume.car.map(round) as VolumeCoefs,
          att: params.volume.att.map(round) as VolumeCoefs,
        },
      },
      distributions: Object.fromEntries(PROP_MARKETS.map((m) => [m, dists.get(`${m}|model`)!.toFrozen()])) as FrozenModelFile["distributions"],
      calibrators: Object.fromEntries(
        (["rec", "rush", "pass"] as Family[]).map((f) => { const c = calibrators.get(`${f}|model`)!; return [f, { a: round(c.a), b: round(c.b) }]; })
      ) as FrozenModelFile["calibrators"],
      validation: validation.map((v) => ({ ...v, maeModel: round(v.maeModel), maeSeasonAvg: round(v.maeSeasonAvg), brierModel: round(v.brierModel), brierSeasonAvg: round(v.brierSeasonAvg), deltaLo: round(v.deltaLo), deltaHi: round(v.deltaHi) })),
      dataManifest: Object.fromEntries(
        ["players", "stats_player", "snap_counts"].map((tag) => [tag, Object.fromEntries(Object.entries(readManifest(tag)).map(([f, e]) => [f, e.sha256]))])
      ),
    };
    const out = path.join(process.cwd(), "src/lib/nfl/props/frozen", `nfl-props-${NFL_PROPS_MODEL_VERSION}.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(file) + "\n");
    console.log(`\nFroze model ${NFL_PROPS_MODEL_VERSION} → ${path.relative(process.cwd(), out)}`);
  }

  // 7. a sanity sample: most recent validation week's top receiving projections
  const lastVal = idxAll.filter((i) => inRange(pgAt(i).season, VALID) && elig(i, "rec"));
  const maxWeek = Math.max(...lastVal.map((i) => pgAt(i).season * 100 + pgAt(i).week));
  const sample = lastVal.filter((i) => pgAt(i).season * 100 + pgAt(i).week === maxWeek).sort((a, b) => proj[b].receivingYards - proj[a].receivingYards).slice(0, 8);
  console.log(`\nSanity sample — top receiving-yard projections, ${Math.floor(maxWeek / 100)} week ${maxWeek % 100}:`);
  for (const i of sample) {
    const b = baselines.get(pgAt(i))!;
    console.log(
      `  ${pgAt(i).name.padEnd(22)} ${pgAt(i).team.padEnd(4)} proj ${proj[i].receivingYards.toFixed(1).padStart(5)} rec yds (${proj[i].receptions.toFixed(1)} rec)  ` +
        `season avg ${b.seasonAvg!.receivingYards.toFixed(1).padStart(5)}  actual ${pgAt(i).receivingYards}`
    );
  }
}

/** Neutral defaults for components not under test while fitting one k at a time. */
function shrinkFitDefaults(): ShrinkParams {
  return { kTgtShare: 30, kCarShare: 30, kAttShare: 30, kCatch: 30, kYpt: 30, kYpc: 30, kCmp: 30, kYpa: 30 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
