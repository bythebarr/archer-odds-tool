import { writeFileSync } from "node:fs";
import path from "node:path";
import { fetchNflGames } from "@/lib/nfl/games";
import { franchise } from "@/lib/nfl/pbp/franchise";
import { loadPlayerGames, type PlayerGame } from "@/lib/nfl/props/playerGames";
import type { GameContext } from "@/lib/nfl/props/engine";
import { loadInjuryReports } from "@/lib/nfl/props/injuries";
import { replayHistory, type PlayerView } from "@/lib/nfl/props/replay";
import { LogisticCalibrator, RatioDistribution } from "@/lib/nfl/props/distribution";
import { poissonOver } from "@/lib/nfl/props/td";
import { interceptionLambda, type ExtraMarket, type IntParams } from "@/lib/nfl/props/extras";
import { NFL_PROPS_MODEL_VERSION, type ExtraValidationRow, type FrozenModelFile } from "@/lib/nfl/props/frozen";
import frozenV12 from "@/lib/nfl/props/frozen/nfl-props-v1.2.0.json";

/**
 * NFL prop markets, batch A (v1.3 candidates), on top of the frozen v1.2 model
 * via the shared replayer: rush+rec yards, pass+rush yards, interceptions
 * thrown, 2+ touchdowns. Train 2014–2019, validation 2020–2022, test sealed.
 * Each market is compared with the naive season-average and last-5 baselines,
 * each with its own train-fit distribution and calibration.
 *
 * Run: `npm run experiment:nfl:props:extras`  (NFL_PROPS_FREEZE=1 to write v1.3.0)
 */

const FIRST = 2013;
const TRAIN = [2014, 2019] as const;
const VALID = [2020, 2022] as const;
const TEST = [2023, 2025] as const;
const BOOT = 1000;
const INT_LINES = [0.5, 1.5];

const inRange = (season: number, [a, b]: readonly [number, number]) => season >= a && season <= b;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const clamp = (p: number) => Math.min(0.98, Math.max(0.02, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  pg: PlayerGame;
  v: PlayerView;
  history: readonly PlayerGame[];
}

type Src = "model" | "season" | "l5";
const SRCS: Src[] = ["model", "season", "l5"];

async function main() {
  console.log("NFL prop markets, batch A (v1.3 candidates)\n");
  const frozen = frozenV12 as unknown as FrozenModelFile;
  const games = await fetchNflGames();
  const ctx = new Map<string, GameContext>(games.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }]));
  const { players, teams } = await loadPlayerGames(FIRST, TEST[1]);
  const injuries = await loadInjuryReports(FIRST, TEST[1]);

  const rows: Row[] = [];
  replayHistory(frozen, players, teams, ctx, injuries, (pg, v) => rows.push({ pg, v, history: v.history }));
  console.log(`  ${rows.length} player-game views\n`);

  const inSplit = (r: Row, range: readonly [number, number]) => inRange(r.pg.season, range);
  const seasonRef = (r: Row) => {
    const cur = r.history.filter((g) => g.season === r.pg.season);
    return cur.length ? cur : r.history.filter((g) => g.season === r.pg.season - 1);
  };
  const avgOf = (gs: readonly PlayerGame[], f: (g: PlayerGame) => number) => (gs.length ? mean(gs.map(f)) : null);

  // ── market definitions ──
  interface MarketDef {
    market: ExtraMarket;
    eligible: (r: Row) => boolean;
    actual: (g: PlayerGame) => number;
  }
  const rushRec: MarketDef = {
    market: "rushRecYards",
    eligible: (r) => r.pg.position !== "QB" && (r.v.baseline.eligible.rec || r.v.baseline.eligible.rush),
    actual: (g) => g.rushingYards + g.receivingYards,
  };
  const passRush: MarketDef = {
    market: "passRushYards",
    eligible: (r) => r.v.baseline.eligible.pass,
    actual: (g) => g.passingYards + g.rushingYards,
  };
  const ratioModelMean = (m: ExtraMarket, r: Row) =>
    m === "rushRecYards" ? r.v.proj.rushingYards + r.v.proj.receivingYards : r.v.proj.passingYards + r.v.proj.rushingYards;

  // ── 1. combo yards: ratio distribution + calibration at book-proxy lines, per source ──
  const validation: ExtraValidationRow[] = [];
  const frozenRatio: Partial<Record<ExtraMarket, { dist: ReturnType<RatioDistribution["toFrozen"]>; cal: { a: number; b: number } }>> = {};
  const report = (name: string, metric: "brier" | "logloss", items: { r: Row; y: number; p: (s: Src) => number }[], maeOf?: (s: Src) => number) => {
    const score = (s: Src, it: (typeof items)[number]) => (metric === "brier" ? (it.p(s) - it.y) ** 2 : logLoss(it.p(s), it.y));
    const m = (s: Src) => mean(items.map((it) => score(s, it)));
    const byWeek = new Map<string, number[]>();
    for (const it of items) {
      const wk = `${it.r.pg.season}_${it.r.pg.week}`;
      (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(score("model", it) - score("season", it));
    }
    const weeks = [...byWeek.values()];
    const rand = rng(20260923);
    const d: number[] = [];
    for (let b = 0; b < BOOT; b++) {
      const xs: number[] = [];
      for (let j = 0; j < weeks.length; j++) xs.push(...weeks[Math.floor(rand() * weeks.length)]);
      d.push(mean(xs));
    }
    d.sort((a, b) => a - b);
    const lo = d[Math.floor(0.025 * BOOT)];
    const hi = d[Math.floor(0.975 * BOOT)];
    console.log(
      `  ${name.padEnd(18)} n=${String(items.length).padStart(5)}  ${metric} model/season/L5 ${m("model").toFixed(4)} / ${m("season").toFixed(4)} / ${m("l5").toFixed(4)}  ` +
        `Δ ${(m("model") - m("season")).toFixed(4)} [${lo.toFixed(4)}, ${hi.toFixed(4)}]` +
        (maeOf ? `  MAE ${maeOf("model").toFixed(2)} / ${maeOf("season").toFixed(2)} / ${maeOf("l5").toFixed(2)}` : "")
    );
    const bins = Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 }));
    for (const it of items) {
      const p = it.p("model");
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.p += p;
      b.y += it.y;
      b.n++;
    }
    console.log(`    calibration: ${bins.filter((b) => b.n > 0).map((b) => `${(b.p / b.n).toFixed(2)}→${(b.y / b.n).toFixed(2)} (n=${b.n})`).join("  ")}`);
    return { n: items.length, metric, model: m("model"), season: m("season"), deltaLo: lo, deltaHi: hi };
  };

  const splitsOut: Record<string, ReturnType<typeof report>> = {};
  for (const def of [rushRec, passRush]) {
    const muOf = (r: Row, s: Src) =>
      s === "model" ? ratioModelMean(def.market, r) : s === "season" ? avgOf(seasonRef(r), def.actual) : avgOf(r.history.slice(-5), def.actual);
    const pool = (range: readonly [number, number]) => rows.filter((r) => inSplit(r, range) && def.eligible(r) && SRCS.every((s) => muOf(r, s) !== null));
    const train = pool(TRAIN);
    const dists = new Map(SRCS.map((s) => [s, RatioDistribution.fit(train.map((r) => ({ mu: muOf(r, s)!, y: def.actual(r.pg) })))]));
    const line = (r: Row) => Math.floor(muOf(r, "season")!) + 0.5;
    const cals = new Map(
      SRCS.map((s) => [s, LogisticCalibrator.fit(train.map((r) => ({ p: dists.get(s)!.pOver(muOf(r, s)!, line(r)), y: (def.actual(r.pg) > line(r) ? 1 : 0) as 0 | 1 })))])
    );
    const prob = (r: Row, s: Src) => cals.get(s)!.apply(dists.get(s)!.pOver(muOf(r, s)!, line(r)));
    console.log(`── ${def.market} ──`);
    for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const) {
      const set = pool(range);
      const res = report(
        label,
        "brier",
        set.map((r) => ({ r, y: def.actual(r.pg) > line(r) ? 1 : 0, p: (s: Src) => prob(r, s) })),
        (s) => mean(set.map((r) => Math.abs(def.actual(r.pg) - muOf(r, s)!)))
      );
      if (label === "VALIDATION") splitsOut[def.market] = res;
    }
    const c = cals.get("model")!;
    frozenRatio[def.market] = { dist: dists.get("model")!.toFrozen(), cal: { a: +c.a.toFixed(6), b: +c.b.toFixed(6) } };
  }

  // ── 2. interceptions ──
  console.log(`── interceptions ──`);
  const passRows = (range: readonly [number, number]) => rows.filter((r) => inSplit(r, range) && r.v.baseline.eligible.pass && seasonRef(r).length > 0);
  const passTrain = passRows(TRAIN);
  const poissonLL = (lam: number, k: number) => {
    let logP = -lam + k * Math.log(Math.max(lam, 1e-9));
    for (let i = 2; i <= k; i++) logP -= Math.log(i);
    return -logP;
  };
  let bestInt: { p: IntParams; ll: number } = { p: { kInt: 0, kDefInt: 0, gammaInt: 0 }, ll: Infinity };
  for (const kInt of [100, 200, 400, 800, 1600, 3200])
    for (const kDefInt of [100, 300, 1000, 3000])
      for (const gammaInt of [0, 0.25, 0.5, 0.75, 1]) {
        const p = { kInt, kDefInt, gammaInt };
        const ll = mean(passTrain.map((r) => poissonLL(interceptionLambda(r.v.proj.passAttempts, r.v.set.efficiency, r.v.set.defense, p), r.pg.interceptions)));
        if (ll < bestInt.ll) bestInt = { p, ll };
      }
  console.log(`  fit: kInt=${bestInt.p.kInt} attempts, kDefInt=${bestInt.p.kDefInt}, γ=${bestInt.p.gammaInt}`);
  const intLam = (r: Row, s: Src) =>
    s === "model"
      ? interceptionLambda(r.v.proj.passAttempts, r.v.set.efficiency, r.v.set.defense, bestInt.p)
      : s === "season"
        ? avgOf(seasonRef(r), (g) => g.interceptions)!
        : avgOf(r.history.slice(-5), (g) => g.interceptions)!;
  const intCal = new Map(
    SRCS.map((s) => [s, LogisticCalibrator.fit(passTrain.flatMap((r) => INT_LINES.map((L) => ({ p: clamp(poissonOver(intLam(r, s), L)), y: (r.pg.interceptions > L ? 1 : 0) as 0 | 1 }))))])
  );
  for (const L of INT_LINES)
    for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const) {
      const res = report(`INT o${L} ${label}`, "logloss", passRows(range).map((r) => ({ r, y: r.pg.interceptions > L ? 1 : 0, p: (s: Src) => intCal.get(s)!.apply(clamp(poissonOver(intLam(r, s), L))) })));
      if (label === "VALIDATION") splitsOut[`interceptions o${L}`] = res;
    }

  // ── 3. 2+ touchdowns ──
  console.log(`── 2+ touchdowns ──`);
  const tdRows = (range: readonly [number, number]) =>
    rows.filter((r) => inSplit(r, range) && (r.v.baseline.eligible.rec || r.v.baseline.eligible.rush) && r.v.td && seasonRef(r).length > 0 && r.history.length > 0);
  const multi = (g: PlayerGame) => (g.rushingTds + g.receivingTds >= 2 ? 1 : 0);
  const rawMulti = (r: Row, s: Src) =>
    s === "model" ? poissonOver(r.v.td!.anytimeLambda, 1.5) : s === "season" ? avgOf(seasonRef(r), multi)! : avgOf(r.history.slice(-5), multi)!;
  const multiCal = new Map(SRCS.map((s) => [s, LogisticCalibrator.fit(tdRows(TRAIN).map((r) => ({ p: clamp(rawMulti(r, s)), y: multi(r.pg) as 0 | 1 })))]));
  for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const) {
    const res = report(`2+ TDs ${label}`, "logloss", tdRows(range).map((r) => ({ r, y: multi(r.pg), p: (s: Src) => multiCal.get(s)!.apply(clamp(rawMulti(r, s))) })));
    if (label === "VALIDATION") splitsOut["twoPlusTds"] = res;
  }

  for (const [market, v] of Object.entries(splitsOut)) validation.push({ market, ...v });

  console.log("\nTest window 2023–2025 remains sealed.");

  if (process.env.NFL_PROPS_FREEZE === "1") {
    const round = (x: number) => +x.toFixed(6);
    const cal = (c: LogisticCalibrator) => ({ a: round(c.a), b: round(c.b) });
    const file: FrozenModelFile = {
      ...frozen,
      modelVersion: NFL_PROPS_MODEL_VERSION,
      frozenAt: new Date().toISOString(),
      extras: {
        ratio: { rushRecYards: frozenRatio.rushRecYards!, passRushYards: frozenRatio.passRushYards! },
        interceptions: { params: bestInt.p, cal: cal(intCal.get("model")!) },
        twoPlusTds: { cal: cal(multiCal.get("model")!) },
        validation: validation.map((v) => ({ ...v, model: round(v.model), season: round(v.season), deltaLo: round(v.deltaLo), deltaHi: round(v.deltaHi) })),
      },
    };
    const out = path.join(process.cwd(), "src/lib/nfl/props/frozen", `nfl-props-${NFL_PROPS_MODEL_VERSION}.json`);
    writeFileSync(out, JSON.stringify(file) + "\n");
    console.log(`Froze ${NFL_PROPS_MODEL_VERSION} (v1.2 + batch A extras) → ${path.relative(process.cwd(), out)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
