import { fetchNflGames } from "@/lib/nfl/games";
import { franchise } from "@/lib/nfl/pbp/franchise";
import { loadPlayerGames, type PlayerGame } from "@/lib/nfl/props/playerGames";
import { walkForward, type GameContext, type Snapshot } from "@/lib/nfl/props/engine";
import { components } from "@/lib/nfl/props/model";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { NFL_PROPS_MODEL_VERSION, type FrozenModelFile, type TdValidationRow } from "@/lib/nfl/props/frozen";
import frozenV11 from "@/lib/nfl/props/frozen/nfl-props-v1.1.0.json";
import { EligibilityTracker, type Baseline } from "@/lib/nfl/props/eligibility";
import { LogisticCalibrator } from "@/lib/nfl/props/distribution";
import {
  anytimeLambda, passTdFraction, passTdLambda, poissonOver, projectTeamTds, tdShare, teamTdFeatures, type TdParams,
} from "@/lib/nfl/props/td";

/**
 * NFL touchdown-prop experiment (v1.2 candidate): anytime TD (rush + receiving)
 * and passing TDs over 0.5 / 1.5 / 2.5, built on the frozen v1.1 engine
 * (usage/team decay and shrinkage are reused, not refit). Only TD-specific
 * parameters are fit, on train 2014–2019; validation 2020–2022; test sealed.
 *
 * Baselines — what a naive app shows: the player's season TD rate (share of
 * games with a TD; last season before his first game) and last-5 rate, and
 * for passing TDs the season / last-5 average run through a Poisson. Every
 * source, baselines included, gets its own logistic recalibration on train,
 * so the comparison is between information, not calibration luck.
 *
 * Run: `npm run experiment:nfl:props:td`
 */

const FIRST = 2013;
const TRAIN = [2014, 2019] as const;
const VALID = [2020, 2022] as const;
const TEST = [2023, 2025] as const;
const BOOT = 1000;
const TD_HALF_LIVES = [4, 8, 16, 32];
const K_TD = [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
const K_PASS = [2, 5, 10, 20, 50, 100];
const PASS_LINES = [0.5, 1.5, 2.5];

const inRange = (season: number, [a, b]: readonly [number, number]) => season >= a && season <= b;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const clamp = (p: number) => Math.min(0.98, Math.max(0.02, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));

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

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TdBaseline {
  seasonRate: number | null;
  l5Rate: number | null;
  seasonPassTd: number | null;
  l5PassTd: number | null;
}

async function main() {
  console.log("NFL touchdown-prop experiment (v1.2 candidate)\n");
  // Built on the frozen v1.1.0 file directly (not the live loader), so v1.2.0 = v1.1.0 + a touchdown block, byte-for-byte otherwise.
  const frozen = frozenV11 as unknown as FrozenModelFile;
  const games = await fetchNflGames();
  const ctx = new Map<string, GameContext>(games.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }]));
  const { players, teams } = await loadPlayerGames(FIRST, TEST[1]);
  const teamVol = new Map(teams.map((t) => [`${t.gameId}|${t.team}`, t]));

  // baselines + eligibility (shared rules) + TD baselines, all strictly pre-week
  const sorted = [...players].sort((a, b) => a.season - b.season || a.week - b.week);
  const elig = new Map<PlayerGame, Baseline>();
  const tdBase = new Map<PlayerGame, TdBaseline>();
  {
    const tracker = new EligibilityTracker();
    const hist = new Map<string, PlayerGame[]>();
    const anyTd = (g: PlayerGame) => (g.rushingTds + g.receivingTds > 0 ? 1 : 0);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length && sorted[j].season === sorted[i].season && sorted[j].week === sorted[i].week) j++;
      const wk = sorted.slice(i, j);
      for (const pg of wk) {
        elig.set(pg, tracker.baseline(pg));
        const h = hist.get(pg.playerId) ?? [];
        const cur = h.filter((g) => g.season === pg.season);
        const ref = cur.length ? cur : h.filter((g) => g.season === pg.season - 1);
        const l5 = h.slice(-5);
        tdBase.set(pg, {
          seasonRate: ref.length ? mean(ref.map(anyTd)) : null,
          l5Rate: l5.length ? mean(l5.map(anyTd)) : null,
          seasonPassTd: ref.length ? mean(ref.map((g) => g.passingTds)) : null,
          l5PassTd: l5.length ? mean(l5.map((g) => g.passingTds)) : null,
        });
      }
      tracker.foldWeek(wk);
      for (const pg of wk) (hist.get(pg.playerId) ?? hist.set(pg.playerId, []).get(pg.playerId)!).push(pg);
      i = j;
    }
  }

  // walks: frozen usage + team engines, plus TD-share half-life candidates
  const walk = (params: { halfLife: number; seasonCarry: number }) => {
    const out: Snapshot[] = [];
    walkForward(players, teams, ctx, params, (s) => out.push(s));
    return out;
  };
  const usageSnaps = walk(frozen.engine.usage);
  const teamSnaps = walk(frozen.engine.team);
  const tdPasses = TD_HALF_LIVES.map((h) => ({ h, snaps: walk({ halfLife: h, seasonCarry: frozen.engine.usage.seasonCarry }) }));
  const N = usageSnaps.length;
  const pgAt = (i: number) => usageSnaps[i].pg;
  const tv = (i: number) => teamVol.get(`${pgAt(i).gameId}|${pgAt(i).team}`)!;
  const comps = usageSnaps.map((s) => components({ usage: s, efficiency: s }, frozen.params.shrink));
  const idx = [...Array(N).keys()];
  const anyElig = (i: number) => {
    const e = elig.get(pgAt(i))!.eligible;
    return (e.rec || e.rush) && tdBase.get(pgAt(i))!.seasonRate !== null && tdBase.get(pgAt(i))!.l5Rate !== null;
  };
  const passElig = (i: number) => elig.get(pgAt(i))!.eligible.pass && tdBase.get(pgAt(i))!.seasonPassTd !== null;
  const train = idx.filter((i) => inRange(pgAt(i).season, TRAIN));

  // 1. team TD model (train team-games)
  const seen = new Set<string>();
  const teamRows = train.filter((i) => {
    const k = `${pgAt(i).gameId}|${pgAt(i).team}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const teamTd = ols(teamRows.map((i) => teamTdFeatures(teamSnaps[i])), teamRows.map((i) => tv(i).tds)) as [number, number, number];
  const teamRmse = Math.sqrt(mean(teamRows.map((i) => (tv(i).tds - projectTeamTds(teamSnaps[i], { teamTd } as TdParams)) ** 2)));
  console.log(`Team TDs = ${teamTd[0].toFixed(3)} + ${teamTd[1].toFixed(4)}·implied pts + ${teamTd[2].toFixed(3)}·recent TDs/g  (train RMSE ${teamRmse.toFixed(3)}, n=${teamRows.length})`);

  // 2. role prior: player TDs ≈ actual team TDs × (αcar·carry share + αtgt·target share)
  const anyTrain = train.filter(anyElig);
  const [alphaCar, alphaTgt] = ols(
    anyTrain.map((i) => [tv(i).tds * comps[i].carShare, tv(i).tds * comps[i].tgtShare]),
    anyTrain.map((i) => pgAt(i).rushingTds + pgAt(i).receivingTds)
  );
  console.log(`Role prior: TD share ≈ ${alphaCar.toFixed(3)}·carry share + ${alphaTgt.toFixed(3)}·target share`);

  // 3. TD-share half-life × kTd by train log loss (anytime)
  const teamProj = idx.map((i) => projectTeamTds(teamSnaps[i], { teamTd } as TdParams));
  let best = { h: 0, kTd: 0, ll: Infinity };
  for (const pass of tdPasses)
    for (const kTd of K_TD) {
      const ll = mean(anyTrain.map((i) => {
        const lam = anytimeLambda(teamProj[i], tdShare(pass.snaps[i], comps[i], { alphaCar, alphaTgt, kTd }));
        return logLoss(1 - Math.exp(-lam), pgAt(i).rushingTds + pgAt(i).receivingTds > 0 ? 1 : 0);
      }));
      if (ll < best.ll) best = { h: pass.h, kTd, ll };
    }
  const tdSnaps = tdPasses.find((p) => p.h === best.h)!.snaps;
  console.log(`TD share: half-life ${best.h} games, kTd=${best.kTd} phantom team TDs (train log loss ${best.ll.toFixed(4)})`);

  // 4. pass-TD fraction shrinkage by train log loss over the pass lines
  const passTrain = train.filter(passElig);
  let bestK = { k: 0, ll: Infinity };
  for (const k of K_PASS) {
    const ll = mean(passTrain.flatMap((i) => {
      const lam = passTdLambda(teamProj[i], passTdFraction(teamSnaps[i], k), comps[i].attShare);
      return PASS_LINES.map((L) => logLoss(poissonOver(lam, L), pgAt(i).passingTds > L ? 1 : 0));
    }));
    if (ll < bestK.ll) bestK = { k, ll };
  }
  console.log(`Pass-TD fraction: kPassFrac=${bestK.k}`);
  const tdParams: TdParams = { teamTd, alphaCar, alphaTgt, kTd: best.kTd, kPassFrac: bestK.k };

  // 5. raw probabilities per source, then logistic recalibration per source on train
  type Src = "model" | "season" | "l5";
  const SRCS: Src[] = ["model", "season", "l5"];
  const anyRaw = (i: number, s: Src) => {
    const b = tdBase.get(pgAt(i))!;
    if (s === "season") return b.seasonRate!;
    if (s === "l5") return b.l5Rate!;
    return 1 - Math.exp(-anytimeLambda(teamProj[i], tdShare(tdSnaps[i], comps[i], tdParams)));
  };
  const passLam = (i: number, s: Src) => {
    const b = tdBase.get(pgAt(i))!;
    if (s === "season") return b.seasonPassTd!;
    if (s === "l5") return b.l5PassTd ?? b.seasonPassTd!;
    return passTdLambda(teamProj[i], passTdFraction(teamSnaps[i], tdParams.kPassFrac), comps[i].attShare);
  };
  const yAny = (i: number) => (pgAt(i).rushingTds + pgAt(i).receivingTds > 0 ? 1 : 0);
  const cal = new Map<string, LogisticCalibrator>();
  for (const s of SRCS) {
    cal.set(`any|${s}`, LogisticCalibrator.fit(anyTrain.map((i) => ({ p: clamp(anyRaw(i, s)), y: yAny(i) as 0 | 1 }))));
    cal.set(
      `pass|${s}`,
      LogisticCalibrator.fit(passTrain.flatMap((i) => PASS_LINES.map((L) => ({ p: clamp(poissonOver(passLam(i, s), L)), y: (pgAt(i).passingTds > L ? 1 : 0) as 0 | 1 }))))
    );
  }
  const pAny = (i: number, s: Src) => cal.get(`any|${s}`)!.apply(clamp(anyRaw(i, s)));
  const pPass = (i: number, s: Src, L: number) => cal.get(`pass|${s}`)!.apply(clamp(poissonOver(passLam(i, s), L)));

  // 6. evaluate
  const evaluate = (label: string, range: readonly [number, number]): TdValidationRow[] => {
    console.log(`\n── ${label} ──`);
    const rows: TdValidationRow[] = [];
    const report = (name: string, items: { i: number; y: number; p: (s: Src) => number }[]) => {
      const br = (s: Src) => mean(items.map((it) => (it.p(s) - it.y) ** 2));
      const ll = (s: Src) => mean(items.map((it) => logLoss(it.p(s), it.y)));
      const byWeek = new Map<string, number[]>();
      for (const it of items) {
        const wk = `${pgAt(it.i).season}_${pgAt(it.i).week}`;
        (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(logLoss(it.p("model"), it.y) - logLoss(it.p("season"), it.y));
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
      rows.push({
        market: name, n: items.length, logLossModel: ll("model"), logLossSeason: ll("season"), brierModel: br("model"), brierSeason: br("season"),
        deltaLo: d[Math.floor(0.025 * BOOT)], deltaHi: d[Math.floor(0.975 * BOOT)],
      });
      console.log(
        `  ${name.padEnd(16)} n=${String(items.length).padStart(5)}  base rate ${mean(items.map((x) => x.y)).toFixed(3)}  ` +
          `Brier model/season/L5 ${br("model").toFixed(4)} / ${br("season").toFixed(4)} / ${br("l5").toFixed(4)}  ` +
          `LogLoss ${ll("model").toFixed(4)} / ${ll("season").toFixed(4)} / ${ll("l5").toFixed(4)}  ` +
          `ΔLL(model−season) ${(ll("model") - ll("season")).toFixed(4)} [${d[Math.floor(0.025 * BOOT)].toFixed(4)}, ${d[Math.floor(0.975 * BOOT)].toFixed(4)}]`
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
    };
    const anyRows = idx.filter((i) => inRange(pgAt(i).season, range) && anyElig(i));
    report("anytime TD", anyRows.map((i) => ({ i, y: yAny(i), p: (s: Src) => pAny(i, s) })));
    const passRows = idx.filter((i) => inRange(pgAt(i).season, range) && passElig(i));
    for (const L of PASS_LINES)
      report(`pass TDs o${L}`, passRows.map((i) => ({ i, y: pgAt(i).passingTds > L ? 1 : 0, p: (s: Src) => pPass(i, s, L) })));
    return rows;
  };
  evaluate("TRAIN 2014–2019 (in-sample)", TRAIN);
  const validation = evaluate("VALIDATION 2020–2022", VALID);
  console.log("\nTest window 2023–2025 remains sealed.");
  if (process.env.NFL_PROPS_FREEZE === "1") {
    const round = (x: number) => +x.toFixed(6);
    const c = (k: string) => { const x = cal.get(k)!; return { a: round(x.a), b: round(x.b) }; };
    const file: FrozenModelFile = {
      ...frozen,
      modelVersion: NFL_PROPS_MODEL_VERSION,
      frozenAt: new Date().toISOString(),
      td: {
        params: { ...tdParams, teamTd: tdParams.teamTd.map(round) as TdParams["teamTd"], alphaCar: round(alphaCar), alphaTgt: round(alphaTgt) },
        halfLife: best.h,
        calibrators: { any: c("any|model"), pass: c("pass|model") },
        validation: validation.map((v) => ({ ...v, logLossModel: round(v.logLossModel), logLossSeason: round(v.logLossSeason), brierModel: round(v.brierModel), brierSeason: round(v.brierSeason), deltaLo: round(v.deltaLo), deltaHi: round(v.deltaHi) })),
      },
    };
    const out = path.join(process.cwd(), "src/lib/nfl/props/frozen", `nfl-props-${NFL_PROPS_MODEL_VERSION}.json`);
    writeFileSync(out, JSON.stringify(file) + "\n");
    console.log(`\nFroze ${NFL_PROPS_MODEL_VERSION} (v1.1 model + touchdown block) → ${path.relative(process.cwd(), out)}`);
  }
  console.log(`\nFitted TdParams: ${JSON.stringify({ ...tdParams, tdHalfLife: best.h, calibrators: { any: cal.get("any|model"), pass: cal.get("pass|model") } })}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
