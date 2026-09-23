import { writeFileSync } from "node:fs";
import path from "node:path";
import { fetchNflGames } from "@/lib/nfl/games";
import { franchise } from "@/lib/nfl/pbp/franchise";
import { loadSeasonPlayExtras, type PlayerGameLongest } from "@/lib/nfl/pbp/playExtras";
import { loadPlayerGames, type PlayerGame } from "@/lib/nfl/props/playerGames";
import type { GameContext } from "@/lib/nfl/props/engine";
import { loadInjuryReports } from "@/lib/nfl/props/injuries";
import { replayHistory, type PlayerView } from "@/lib/nfl/props/replay";
import { LogisticCalibrator, RatioDistribution } from "@/lib/nfl/props/distribution";
import { impliedTeamPoints, poissonOver } from "@/lib/nfl/props/td";
import { loadKickerGames, kickingPoints, type KickerGame } from "@/lib/nfl/props/kickerGames";
import {
  KickerTracker, buildSurvival, expectedLongest, fgLambda, firstTdProbability, kickingPointsMean, pLongestOver,
  type KickParams, type SurvivalCurve,
} from "@/lib/nfl/props/batchB";
import { NFL_PROPS_MODEL_VERSION, type ExtraValidationRow, type FrozenBatchB, type FrozenModelFile } from "@/lib/nfl/props/frozen";
import frozenV13 from "@/lib/nfl/props/frozen/nfl-props-v1.3.0.json";

/**
 * NFL prop markets, batch B (v1.4 candidates) on the frozen v1.3 model:
 * longest reception / rush / completion, kicker FG made and kicking points,
 * first TD scorer. Train 2014–2019, validation 2020–2022, test sealed. Each
 * market is compared with season-average and last-5 baselines, each with
 * its own train-fit distribution and calibration.
 *
 * Run: `npm run experiment:nfl:props:batchb`  (NFL_PROPS_FREEZE=1 writes v1.4.0)
 */

const FIRST = 2013;
const TRAIN = [2014, 2019] as const;
const VALID = [2020, 2022] as const;
const TEST = [2023, 2025] as const;
const BOOT = 1000;
const FG_LINES = [0.5, 1.5, 2.5];

const inRange = (season: number, [a, b]: readonly [number, number]) => season >= a && season <= b;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const clamp = (p: number) => Math.min(0.98, Math.max(0.02, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));
const avgOf = <T,>(xs: readonly T[], f: (x: T) => number) => (xs.length ? mean(xs.map(f)) : null);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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

type Src = "model" | "season" | "l5";
const SRCS: Src[] = ["model", "season", "l5"];
const validation: ExtraValidationRow[] = [];

interface Item {
  season: number;
  week: number;
  y: number;
  p: (s: Src) => number;
}

function report(name: string, metric: "brier" | "logloss", items: Item[], record: boolean, extra = "") {
  const score = (s: Src, it: Item) => (metric === "brier" ? (it.p(s) - it.y) ** 2 : logLoss(it.p(s), it.y));
  const m = (s: Src) => mean(items.map((it) => score(s, it)));
  const byWeek = new Map<string, number[]>();
  for (const it of items) (byWeek.get(`${it.season}_${it.week}`) ?? byWeek.set(`${it.season}_${it.week}`, []).get(`${it.season}_${it.week}`)!).push(score("model", it) - score("season", it));
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
    `  ${name.padEnd(26)} n=${String(items.length).padStart(5)}  ${metric} model/season/L5 ${m("model").toFixed(4)} / ${m("season").toFixed(4)} / ${m("l5").toFixed(4)}  ` +
      `Δ ${(m("model") - m("season")).toFixed(4)} [${lo.toFixed(4)}, ${hi.toFixed(4)}]${extra}`
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
  if (record) validation.push({ market: name.replace(/ VALIDATION$/, ""), n: items.length, metric, model: m("model"), season: m("season"), deltaLo: lo, deltaHi: hi });
}

async function main() {
  console.log("NFL prop markets, batch B (v1.4 candidates)\n");
  const frozen = frozenV13 as unknown as FrozenModelFile;
  const games = await fetchNflGames();
  const ctx = new Map<string, GameContext>(games.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }]));
  const { players, teams } = await loadPlayerGames(FIRST, TEST[1]);
  const injuries = await loadInjuryReports(FIRST, TEST[1]);
  const kickers = await loadKickerGames(FIRST, TEST[1]);

  // play-level extras
  const longest = new Map<string, PlayerGameLongest>();
  const firstTd = new Map<string, string | null>();
  for (let s = FIRST; s <= TEST[1]; s++) {
    const x = await loadSeasonPlayExtras(s);
    for (const l of x.longest) longest.set(`${l.gameId}|${l.playerId}`, l);
    for (const f of x.firstTds) firstTd.set(f.gameId, f.playerId);
  }
  const lg = (gameId: string, playerId: string) => longest.get(`${gameId}|${playerId}`);

  // replay: skill-player views + per-game team TD projections (pre-week) for kickers and first-TD
  interface Row { pg: PlayerGame; v: PlayerView }
  const rows: Row[] = [];
  const teamTdsAt = new Map<string, { teamTds: number; implied: number }>();
  const weekGames = new Map<string, { gameId: string; home: string; away: string }[]>();
  for (const g of games) {
    if (g.gameType !== "REG") continue;
    const k = `${g.season}|${g.week}`;
    (weekGames.get(k) ?? weekGames.set(k, []).get(k)!).push({ gameId: g.gameId, home: franchise(g.home), away: franchise(g.away) });
  }
  replayHistory(frozen, players, teams, ctx, injuries, (pg, v) => rows.push({ pg, v }), (r, season, week) => {
    for (const g of weekGames.get(`${season}|${week}`) ?? []) {
      for (const [team, opp] of [[g.home, g.away], [g.away, g.home]]) {
        const tv = r.teamView(team, opp, g.gameId, season, week, ctx.get(g.gameId));
        teamTdsAt.set(`${g.gameId}|${team}`, { teamTds: tv.teamTds ?? 2.4, implied: impliedTeamPoints(tv.snap) });
      }
    }
  });
  console.log(`  ${rows.length} skill views, ${kickers.length} kicker games, ${teamTdsAt.size} team-game TD projections\n`);

  const seasonRef = <T extends { season: number }>(hist: readonly T[], season: number) => {
    const cur = hist.filter((g) => g.season === season);
    return cur.length ? cur : hist.filter((g) => g.season === season - 1);
  };
  const positionOf = new Map(players.map((p) => [p.playerId, p.position]));

  // ── 1. longest plays ──
  const trainGains = { rec: new Map<string, number[]>(), rush: new Map<string, number[]>(), cmp: [] as number[] };
  for (const l of longest.values()) {
    const season = Number(l.gameId.slice(0, 4));
    if (!inRange(season, TRAIN)) continue;
    const pos = positionOf.get(l.playerId);
    if (pos && pos !== "QB") (trainGains.rec.get(pos) ?? trainGains.rec.set(pos, []).get(pos)!).push(...l.receptions);
    if (pos) (trainGains.rush.get(pos) ?? trainGains.rush.set(pos, []).get(pos)!).push(...l.rushes);
    if (pos === "QB") trainGains.cmp.push(...l.completions);
  }
  const curves = {
    rec: Object.fromEntries([...trainGains.rec].map(([p, g]) => [p, buildSurvival(g)])) as Record<string, SurvivalCurve>,
    rush: Object.fromEntries([...trainGains.rush].map(([p, g]) => [p, buildSurvival(g)])) as Record<string, SurvivalCurve>,
    cmp: buildSurvival(trainGains.cmp),
  };
  console.log(`Single-play curves (train): rec ${Object.entries(curves.rec).map(([p, c]) => `${p} mean ${c.mean.toFixed(1)}`).join(", ")}; rush ${Object.entries(curves.rush).map(([p, c]) => `${p} ${c.mean.toFixed(1)}`).join(", ")}; completions ${curves.cmp.mean.toFixed(1)}`);

  const longestDefs = [
    { market: "longestReception", fam: "rec" as const, mu: (v: PlayerView) => v.proj.receptions, ypp: (v: PlayerView) => (v.base.catchRate > 0 ? v.base.ypt / v.base.catchRate : 0), curve: (pos: string) => curves.rec[pos === "QB" ? "WR" : pos], actual: (l?: PlayerGameLongest) => l?.longestReception ?? 0 },
    { market: "longestRush", fam: "rush" as const, mu: (v: PlayerView) => v.proj.rushAttempts, ypp: (v: PlayerView) => v.base.ypc, curve: (pos: string) => curves.rush[pos] ?? curves.rush.RB, actual: (l?: PlayerGameLongest) => l?.longestRush ?? 0 },
    { market: "longestCompletion", fam: "pass" as const, mu: (v: PlayerView) => v.proj.completions, ypp: (v: PlayerView) => (v.base.cmpRate > 0 ? v.base.ypa / v.base.cmpRate : 0), curve: () => curves.cmp, actual: (l?: PlayerGameLongest) => l?.longestCompletion ?? 0 },
  ];
  const longestCals: Record<string, { a: number; b: number }> = {};
  for (const def of longestDefs) {
    console.log(`── ${def.market} ──`);
    const elig = (r: Row) => r.v.baseline.eligible[def.fam] && r.v.history.length >= 2;
    const muOf = (r: Row, s: Src) => {
      if (s === "model") return expectedLongest(def.mu(r.v), def.curve(r.pg.position), def.ypp(r.v));
      const hist = s === "season" ? seasonRef(r.v.history, r.pg.season) : r.v.history.slice(-5);
      return avgOf(hist, (g) => def.actual(lg(g.gameId, g.playerId)));
    };
    const pool = (range: readonly [number, number]) => rows.filter((r) => inRange(r.pg.season, range) && elig(r) && muOf(r, "season") !== null && muOf(r, "season")! > 0);
    const train = pool(TRAIN);
    const line = (r: Row) => Math.floor(muOf(r, "season")!) + 0.5;
    const raw = (r: Row, s: Src, L: number) =>
      s === "model" ? clamp(pLongestOver(def.mu(r.v), def.curve(r.pg.position), def.ypp(r.v), L)) : baseDist.get(s)!.pOver(muOf(r, s)!, L);
    const baseDist = new Map((["season", "l5"] as Src[]).map((s) => [s, RatioDistribution.fit(train.map((r) => ({ mu: muOf(r, s)!, y: def.actual(lg(r.pg.gameId, r.pg.playerId)) })))]));
    const cals = new Map(SRCS.map((s) => [s, LogisticCalibrator.fit(train.map((r) => ({ p: raw(r, s, line(r)), y: (def.actual(lg(r.pg.gameId, r.pg.playerId)) > line(r) ? 1 : 0) as 0 | 1 })))]));
    for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const) {
      const set = pool(range);
      const mae = (s: Src) => mean(set.map((r) => Math.abs(def.actual(lg(r.pg.gameId, r.pg.playerId)) - muOf(r, s)!)));
      report(
        `${def.market} ${label}`,
        "brier",
        set.map((r) => ({ season: r.pg.season, week: r.pg.week, y: def.actual(lg(r.pg.gameId, r.pg.playerId)) > line(r) ? 1 : 0, p: (s: Src) => cals.get(s)!.apply(raw(r, s, line(r))) })),
        label === "VALIDATION",
        `  MAE ${mae("model").toFixed(2)} / ${mae("season").toFixed(2)} / ${mae("l5").toFixed(2)}`
      );
    }
    const c = cals.get("model")!;
    longestCals[def.market] = { a: +c.a.toFixed(6), b: +c.b.toFixed(6) };
  }

  // ── 2. kickers ──
  console.log(`── kickers ──`);
  const kByWeek = new Map<string, KickerGame[]>();
  for (const k of kickers) (kByWeek.get(`${k.season}|${String(k.week).padStart(2, "0")}`) ?? kByWeek.set(`${k.season}|${String(k.week).padStart(2, "0")}`, []).get(`${k.season}|${String(k.week).padStart(2, "0")}`)!).push(k);
  const kWeeks = [...kByWeek.keys()].sort();
  interface KRow { k: KickerGame; recent: number; hist: KickerGame[]; implied: number; teamTds: number }
  const kickerRows = (halfLife: number, priorGames: number): KRow[] => {
    const tracker = new KickerTracker(halfLife, priorGames);
    const hist = new Map<string, KickerGame[]>();
    const out: KRow[] = [];
    for (const wk of kWeeks) {
      const wkGames = kByWeek.get(wk)!;
      for (const k of wkGames) {
        const t = teamTdsAt.get(`${k.gameId}|${k.team}`);
        const h = hist.get(k.playerId) ?? [];
        if (t && h.length >= 2) out.push({ k, recent: tracker.recentFgm(k.playerId), hist: h.slice(), implied: t.implied, teamTds: t.teamTds });
      }
      tracker.fold(wkGames);
      for (const k of wkGames) (hist.get(k.playerId) ?? hist.set(k.playerId, []).get(k.playerId)!).push(k);
    }
    return out;
  };
  let bestK = { hl: 8, pg: 4, mse: Infinity, fg: [0, 0, 0, 0] as KickParams["fg"], rows: [] as KRow[] };
  for (const hl of [4, 8, 16, 32])
    for (const pg of [2, 4, 8, 16]) {
      const kr = kickerRows(hl, pg);
      const tr = kr.filter((r) => inRange(r.k.season, TRAIN));
      const fg = ols(tr.map((r) => [1, r.implied, r.teamTds, r.recent]), tr.map((r) => r.k.fgMade)) as KickParams["fg"];
      const mse = mean(tr.map((r) => (r.k.fgMade - (fg[0] + fg[1] * r.implied + fg[2] * r.teamTds + fg[3] * r.recent)) ** 2));
      if (mse < bestK.mse) bestK = { hl, pg, mse, fg, rows: kr };
    }
  const kTrain = bestK.rows.filter((r) => inRange(r.k.season, TRAIN));
  const [xpPerTd] = ols(kTrain.map((r) => [r.teamTds]), kTrain.map((r) => r.k.patMade));
  const kick: KickParams = { fg: bestK.fg, xpPerTd, halfLife: bestK.hl, priorGames: bestK.pg };
  console.log(`  FG made λ = ${kick.fg[0].toFixed(3)} + ${kick.fg[1].toFixed(4)}·implied + ${kick.fg[2].toFixed(3)}·team TDs + ${kick.fg[3].toFixed(3)}·recent FGM (half-life ${kick.halfLife}, prior ${kick.priorGames} g); XP = ${xpPerTd.toFixed(3)}·team TDs`);
  const fgLam = (r: KRow, s: Src) =>
    s === "model" ? fgLambda(kick, r.implied, r.teamTds, r.recent) : s === "season" ? avgOf(seasonRef(r.hist, r.k.season), (g) => g.fgMade)! : avgOf(r.hist.slice(-5), (g) => g.fgMade)!;
  const fgCal = new Map(SRCS.map((s) => [s, LogisticCalibrator.fit(kTrain.flatMap((r) => FG_LINES.map((L) => ({ p: clamp(poissonOver(fgLam(r, s), L)), y: (r.k.fgMade > L ? 1 : 0) as 0 | 1 }))))]));
  for (const L of FG_LINES)
    for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const)
      report(
        `fgMade o${L} ${label}`,
        "logloss",
        bestK.rows.filter((r) => inRange(r.k.season, range)).map((r) => ({ season: r.k.season, week: r.k.week, y: r.k.fgMade > L ? 1 : 0, p: (s: Src) => fgCal.get(s)!.apply(clamp(poissonOver(fgLam(r, s), L))) })),
        label === "VALIDATION"
      );
  const kpMu = (r: KRow, s: Src) =>
    s === "model" ? kickingPointsMean(kick, fgLambda(kick, r.implied, r.teamTds, r.recent), r.teamTds) : avgOf(s === "season" ? seasonRef(r.hist, r.k.season) : r.hist.slice(-5), kickingPoints)!;
  const kpDist = new Map(SRCS.map((s) => [s, RatioDistribution.fit(kTrain.map((r) => ({ mu: kpMu(r, s), y: kickingPoints(r.k) })))]));
  const kpLine = (r: KRow) => Math.floor(kpMu(r, "season")) + 0.5;
  const kpCal = new Map(SRCS.map((s) => [s, LogisticCalibrator.fit(kTrain.map((r) => ({ p: kpDist.get(s)!.pOver(kpMu(r, s), kpLine(r)), y: (kickingPoints(r.k) > kpLine(r) ? 1 : 0) as 0 | 1 })))]));
  for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const) {
    const set = bestK.rows.filter((r) => inRange(r.k.season, range));
    const mae = (s: Src) => mean(set.map((r) => Math.abs(kickingPoints(r.k) - kpMu(r, s))));
    report(
      `kickingPoints ${label}`,
      "brier",
      set.map((r) => ({ season: r.k.season, week: r.k.week, y: kickingPoints(r.k) > kpLine(r) ? 1 : 0, p: (s: Src) => kpCal.get(s)!.apply(kpDist.get(s)!.pOver(kpMu(r, s), kpLine(r))) })),
      label === "VALIDATION",
      `  MAE ${mae("model").toFixed(2)} / ${mae("season").toFixed(2)} / ${mae("l5").toFixed(2)}`
    );
  }

  // ── 3. first TD scorer ──
  console.log(`── first TD scorer ──`);
  const ftRows = rows.filter((r) => (r.v.baseline.eligible.rec || r.v.baseline.eligible.rush) && r.v.td && r.v.history.length >= 2 && firstTd.has(r.pg.gameId));
  const isFirst = (gameId: string, playerId: string) => (firstTd.get(gameId) === playerId ? 1 : 0);
  const gameLam = (r: Row, delta: number) => (teamTdsAt.get(`${r.pg.gameId}|${r.pg.team}`)?.teamTds ?? 2.4) + (teamTdsAt.get(`${r.pg.gameId}|${r.pg.opp}`)?.teamTds ?? 2.4) + delta;
  const ftTrain = ftRows.filter((r) => inRange(r.pg.season, TRAIN));
  let bestDelta = { d: 0, ll: Infinity };
  for (const d of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]) {
    const ll = mean(ftTrain.map((r) => logLoss(firstTdProbability(r.v.td!.anytimeLambda, gameLam(r, d)), isFirst(r.pg.gameId, r.pg.playerId))));
    if (ll < bestDelta.ll) bestDelta = { d, ll };
  }
  console.log(`  non-offensive TD rate δ = ${bestDelta.d} per game`);
  const ftRaw = (r: Row, s: Src) => {
    if (s === "model") return clamp(firstTdProbability(r.v.td!.anytimeLambda, gameLam(r, bestDelta.d)));
    const hist = s === "season" ? seasonRef(r.v.history, r.pg.season) : r.v.history.slice(-5);
    return clamp(avgOf(hist, (g) => isFirst(g.gameId, g.playerId)) ?? 0);
  };
  const ftCal = new Map(SRCS.map((s) => [s, LogisticCalibrator.fit(ftTrain.map((r) => ({ p: ftRaw(r, s), y: isFirst(r.pg.gameId, r.pg.playerId) as 0 | 1 })))]));
  for (const [label, range] of [["train", TRAIN], ["VALIDATION", VALID]] as const)
    report(
      `firstTd ${label}`,
      "logloss",
      ftRows.filter((r) => inRange(r.pg.season, range)).map((r) => ({ season: r.pg.season, week: r.pg.week, y: isFirst(r.pg.gameId, r.pg.playerId), p: (s: Src) => ftCal.get(s)!.apply(ftRaw(r, s)) })),
      label === "VALIDATION"
    );

  console.log("\nTest window 2023–2025 remains sealed.");

  if (process.env.NFL_PROPS_FREEZE === "1") {
    const round = (x: number) => +x.toFixed(6);
    const cal = (c: LogisticCalibrator) => ({ a: round(c.a), b: round(c.b) });
    const file: FrozenModelFile = {
      ...frozen,
      modelVersion: NFL_PROPS_MODEL_VERSION,
      frozenAt: new Date().toISOString(),
      batchB: {
        curves,
        longestCal: longestCals as FrozenBatchB["longestCal"],
        kick: { params: { ...kick, fg: kick.fg.map(round) as KickParams["fg"], xpPerTd: round(kick.xpPerTd) }, fgCal: cal(fgCal.get("model")!), kpDist: kpDist.get("model")!.toFrozen(), kpCal: cal(kpCal.get("model")!) },
        firstTd: { delta: bestDelta.d, cal: cal(ftCal.get("model")!) },
        validation: validation.map((v) => ({ ...v, model: round(v.model), season: round(v.season), deltaLo: round(v.deltaLo), deltaHi: round(v.deltaHi) })),
      },
    };
    const out = path.join(process.cwd(), "src/lib/nfl/props/frozen", `nfl-props-${NFL_PROPS_MODEL_VERSION}.json`);
    writeFileSync(out, JSON.stringify(file) + "\n");
    console.log(`Froze ${NFL_PROPS_MODEL_VERSION} (v1.3 + batch B) → ${path.relative(process.cwd(), out)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
