import { fetchNflGames, type NflGame } from "@/lib/nfl/games";
import { loadPlays, readPbpManifest } from "@/lib/nfl/pbp/loader";
import { franchise } from "@/lib/nfl/pbp/franchise";
import { buildTeamGames, type TeamGameObs } from "@/lib/nfl/pbp/teamGames";
import { AsOfRatingBook, METRICS, expectedValue, type Metric, type RatingParams } from "@/lib/nfl/pbp/ratings";
import { collectWalkForwardSamples, fitHomeFieldPoints } from "@/lib/nfl/srs/backtestHarness";

/**
 * NFL play-by-play experiment 1 — opponent-adjusted neutral EPA/play, run
 * exactly as pre-registered in docs/architecture/NFL-PBP-FEASIBILITY.md.
 *
 * Splits (by season): train 2007–2017, validation 2018–2021, test 2022–2025.
 * The test window is SEALED: it is only evaluated with NFL_OPEN_TEST=1, which
 * the pre-registration allows exactly once, after every family's
 * hyperparameters are frozen. Until then this script reports train + validation.
 *
 * Decisive metric: correlation r between (model margin − closing spread) and
 * (actual margin − closing spread) — does the model know something the close
 * doesn't. Break-even at −110 is r ≈ 0.075. Secondary: RMSE, Brier/log loss vs
 * the de-vigged closing moneyline, ATS ROI at the close, all with 95% intervals
 * from a week-block bootstrap.
 *
 * Run: `npm run experiment:nfl:epa`
 */

const TRAIN = [2007, 2017] as const;
const VALID = [2018, 2021] as const;
const TEST = [2022, 2025] as const;
const FIRST_PBP_SEASON = 2006; // one prior season before train
const OPEN_TEST = process.env.NFL_OPEN_TEST === "1";
const BOOT = 2000;
const ATS_EDGE = 1.0;
const WIN_110 = 100 / 110;

const K_GRID = [150, 300, 600, 1200, 2400];
const CARRY_GRID = [0.2, 0.4, 0.6, 0.8];

// ─── small numerics ────────────────────────────────────────────────────────
const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function corr(a: readonly number[], b: readonly number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
/** OLS with intercept-free design matrix X (caller adds columns); normal equations via Gaussian elimination. */
function ols(X: readonly number[][], y: readonly number[]): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) A[r][c] += X[i][r] * X[i][c];
      A[r][p] += X[i][r] * y[i];
    }
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
function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const amToProb = (am: number) => (am > 0 ? 100 / (am + 100) : -am / (-am + 100));

// ─── data ──────────────────────────────────────────────────────────────────
interface GameRow {
  game: NflGame;
  weekKey: string;
  home: string;
  away: string;
  close: number; // closing spread, home perspective (+ = home favored)
  actual: number;
  srs: number | null;
  feats: Record<string, number>;
}

function weekCutoffs(games: readonly NflGame[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of games) {
    const key = `${g.season}_${g.week}`;
    const d = g.date.toISOString().slice(0, 10);
    const cur = m.get(key);
    if (!cur || d < cur) m.set(key, d);
  }
  return m;
}

/** Market-blind hyperparameter fit: weighted MSE predicting each train-window REG team-game's metric from ratings strictly before its week. */
function fitParams(obs: readonly TeamGameObs[], metric: Metric, cutoffs: Map<string, string>): { params: RatingParams; mse: number } {
  let best: { params: RatingParams; mse: number } | null = null;
  const targets = obs.filter((o) => o.seasonType === "REG" && o.season >= TRAIN[0] && o.season <= TRAIN[1]);
  for (const k of K_GRID) {
    for (const carry of CARRY_GRID) {
      const book = new AsOfRatingBook(obs, metric, { k, carry });
      let se = 0, w = 0;
      for (const o of targets) {
        const [sum, n] = metric.of(o);
        if (n === 0) continue;
        const cutoff = cutoffs.get(`${o.season}_${o.week}`)!;
        const pred = expectedValue(book.asOf(o.season, cutoff), o.off, o.def);
        se += n * (sum / n - pred) ** 2;
        w += n;
      }
      const mse = se / w;
      if (!best || mse < best.mse) best = { params: { k, carry }, mse };
    }
  }
  return best!;
}

// ─── evaluation ────────────────────────────────────────────────────────────
interface ModelSpec {
  name: string;
  /** Design row; the fitted linear combination is the model's home-margin projection. */
  x: (g: GameRow) => number[] | null;
}

interface Evaluated {
  rows: GameRow[];
  pred: number[];
}

function report(label: string, ev: Evaluated, sigma: number) {
  const { rows, pred } = ev;
  const dm = rows.map((g, i) => pred[i] - g.close);
  const da = rows.map((g) => g.actual - g.close);
  const r = corr(dm, da);

  // week-block bootstrap for r and ATS ROI
  const weeks = [...new Set(rows.map((g) => g.weekKey))];
  const idxByWeek = new Map<string, number[]>();
  rows.forEach((g, i) => (idxByWeek.get(g.weekKey) ?? idxByWeek.set(g.weekKey, []).get(g.weekKey)!).push(i));
  const atsOutcome = rows.map((g, i) => {
    const edge = dm[i];
    if (Math.abs(edge) < ATS_EDGE) return null;
    const cover = g.actual - g.close;
    if (cover === 0) return 0;
    return Math.sign(cover) === Math.sign(edge) ? WIN_110 : -1;
  });
  const rand = rng(20260923);
  const rs: number[] = [];
  const rois: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    const idx: number[] = [];
    for (let j = 0; j < weeks.length; j++) idx.push(...idxByWeek.get(weeks[Math.floor(rand() * weeks.length)])!);
    rs.push(corr(idx.map((i) => dm[i]), idx.map((i) => da[i])));
    const bets = idx.map((i) => atsOutcome[i]).filter((x): x is number => x !== null);
    rois.push(mean(bets));
  }
  const ci = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return [s[Math.floor(0.025 * s.length)], s[Math.floor(0.975 * s.length)]];
  };
  const bets = atsOutcome.filter((x): x is number => x !== null);
  const rmse = Math.sqrt(mean(rows.map((g, i) => (g.actual - pred[i]) ** 2)));
  const closeRmse = Math.sqrt(mean(rows.map((g) => (g.actual - g.close) ** 2)));

  // win probability vs de-vigged closing moneyline (games with both MLs, no ties)
  let brM = 0, brK = 0, llM = 0, llK = 0, nWp = 0;
  rows.forEach((g, i) => {
    const hm = g.game.homeMoneyline, am = g.game.awayMoneyline;
    if (hm === null || am === null || g.actual === 0) return;
    const ph = amToProb(hm), pa = amToProb(am);
    const pk = ph / (ph + pa);
    const pm = Math.min(0.99, Math.max(0.01, normalCdf(pred[i] / sigma)));
    const y = g.actual > 0 ? 1 : 0;
    brM += (pm - y) ** 2;
    brK += (pk - y) ** 2;
    llM += -(y * Math.log(pm) + (1 - y) * Math.log(1 - pm));
    llK += -(y * Math.log(pk) + (1 - y) * Math.log(1 - pk));
    nWp++;
  });

  const [rlo, rhi] = ci(rs);
  const [ulo, uhi] = ci(rois);
  console.log(
    `  ${label.padEnd(26)} n=${String(rows.length).padStart(4)}  r=${r.toFixed(3)} [${rlo.toFixed(3)}, ${rhi.toFixed(3)}]  ` +
      `RMSE ${rmse.toFixed(2)} (close ${closeRmse.toFixed(2)})  ` +
      `ATS≥${ATS_EDGE}pt ${(mean(bets) * 100).toFixed(1)}% [${(ulo * 100).toFixed(1)}, ${(uhi * 100).toFixed(1)}] n=${bets.length}  ` +
      `Brier ${(brM / nWp).toFixed(4)} vs close ${(brK / nWp).toFixed(4)}  LL ${(llM / nWp).toFixed(4)} vs ${(llK / nWp).toFixed(4)}`
  );
  return r;
}

function perSeason(label: string, ev: Evaluated) {
  const bySeason = new Map<number, number[]>();
  ev.rows.forEach((g, i) => (bySeason.get(g.game.season) ?? bySeason.set(g.game.season, []).get(g.game.season)!).push(i));
  const parts = [...bySeason.entries()].map(([s, idx]) => {
    const r = corr(idx.map((i) => ev.pred[i] - ev.rows[i].close), idx.map((i) => ev.rows[i].actual - ev.rows[i].close));
    return `${s}:${r >= 0 ? "+" : ""}${r.toFixed(3)}`;
  });
  console.log(`    ${label} per-season r: ${parts.join("  ")}`);
}

async function main() {
  console.log("NFL pbp experiment 1 — opponent-adjusted neutral EPA/play\n");
  console.log("Loading nflverse games.csv…");
  const games = await fetchNflGames();
  const cutoffs = weekCutoffs(games);

  console.log(`Loading play-by-play ${FIRST_PBP_SEASON}–${TEST[1]} (cached after first run)…`);
  const plays = await loadPlays(FIRST_PBP_SEASON, TEST[1]);
  const manifest = readPbpManifest();
  console.log(`  ${plays.length} scrimmage plays; ${Object.keys(manifest).length} season files hashed in .cache/nflverse/pbp/manifest.json`);
  const obs = buildTeamGames(plays);
  console.log(`  ${obs.length} team-game observations (neutral situations)\n`);

  // 1. market-blind hyperparameter fit, train window only
  const metricNames = ["epa", "success", "passEpa", "rushEpa"] as const;
  const books = new Map<string, AsOfRatingBook>();
  console.log("Fitting shrinkage k / season carry per metric on train (2007–2017), market-blind:");
  for (const name of metricNames) {
    const metric = METRICS[name];
    const { params, mse } = fitParams(obs, metric, cutoffs);
    console.log(`  ${name.padEnd(8)} k=${params.k} plays, carry=${params.carry}  (train MSE ${mse.toExponential(3)})`);
    books.set(name, new AsOfRatingBook(obs, metric, params));
  }

  // 2. SRS baseline (frozen), keyed by gameId
  const trainGames = games.filter((g) => g.gameType === "REG" && g.season >= TRAIN[0] && g.season <= TRAIN[1] && g.result !== null);
  const hfa = fitHomeFieldPoints(trainGames);
  const srsById = new Map(
    collectWalkForwardSamples(games, { startSeason: TRAIN[0], minGames: 8, homeFieldPoints: hfa }).map((s) => [s.gameId, s.pred.projectedMargin])
  );

  // 3. per-game rows (REG, has close + result)
  const rows: GameRow[] = [];
  for (const g of games) {
    if (g.gameType !== "REG" || g.result === null || g.spreadLine === null) continue;
    if (g.season < TRAIN[0] || g.season > TEST[1]) continue;
    const weekKey = `${g.season}_${g.week}`;
    const cutoff = cutoffs.get(weekKey)!;
    const home = franchise(g.home);
    const away = franchise(g.away);
    const feats: Record<string, number> = {};
    for (const name of metricNames) {
      const r = books.get(name)!.asOf(g.season, cutoff);
      feats[name] = expectedValue(r, home, away) - expectedValue(r, away, home);
    }
    rows.push({ game: g, weekKey, home, away, close: g.spreadLine, actual: g.result, srs: srsById.get(g.gameId) ?? null, feats });
  }

  const hfaCol = (g: GameRow) => (g.game.neutralSite ? 0 : 1);
  const specs: ModelSpec[] = [
    { name: "B0 SRS (frozen)", x: (g) => (g.srs === null ? null : [g.srs]) },
    { name: "EPA/play", x: (g) => [hfaCol(g), g.feats.epa] },
    { name: "Success rate (model-free)", x: (g) => [hfaCol(g), g.feats.success] },
    { name: "Pass EPA + Rush EPA", x: (g) => [hfaCol(g), g.feats.passEpa, g.feats.rushEpa] },
    { name: "SRS + EPA/play", x: (g) => (g.srs === null ? null : [hfaCol(g), g.srs, g.feats.epa]) },
  ];

  const inRange = (g: GameRow, [a, b]: readonly [number, number]) => g.game.season >= a && g.game.season <= b;
  // Common sample: every model scored on exactly the same games.
  const usable = rows.filter((g) => specs.every((s) => s.x(g) !== null));
  const train = usable.filter((g) => inRange(g, TRAIN));
  const valid = usable.filter((g) => inRange(g, VALID));
  const test = usable.filter((g) => inRange(g, TEST));
  console.log(`\nGames: train ${train.length}, validation ${valid.length}, test ${test.length} (${OPEN_TEST ? "OPEN" : "sealed"})\n`);

  const fitted = specs.map((s) => {
    const beta = s.name.startsWith("B0") ? [1] : ols(train.map((g) => s.x(g)!), train.map((g) => g.actual));
    const predict = (g: GameRow) => s.x(g)!.reduce((sum, v, i) => sum + v * beta[i], 0);
    const sigma = Math.sqrt(mean(train.map((g) => (g.actual - predict(g)) ** 2)));
    return { spec: s, beta, predict, sigma };
  });

  for (const [label, set] of [["TRAIN 2007–2017 (in-sample, context only)", train], ["VALIDATION 2018–2021", valid]] as const) {
    console.log(`── ${label} ──`);
    for (const f of fitted) report(f.spec.name, { rows: set, pred: set.map(f.predict) }, f.sigma);
    console.log(`  (close-only baseline: r is undefined by construction; break-even r ≈ 0.075)\n`);
  }
  console.log("Validation per-season stability:");
  for (const f of fitted) perSeason(f.spec.name.padEnd(26), { rows: valid, pred: valid.map(f.predict) });
  console.log("\nFitted coefficients (train):");
  for (const f of fitted) console.log(`  ${f.spec.name.padEnd(26)} β=[${f.beta.map((b) => b.toFixed(3)).join(", ")}]  σ=${f.sigma.toFixed(2)}`);

  if (OPEN_TEST) {
    console.log(`\n── TEST 2022–2025 — opened once, per pre-registration ──`);
    for (const f of fitted) report(f.spec.name, { rows: test, pred: test.map(f.predict) }, f.sigma);
  } else {
    console.log(`\nTest window 2022–2025 remains sealed (set NFL_OPEN_TEST=1 only once, after all families are frozen).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
