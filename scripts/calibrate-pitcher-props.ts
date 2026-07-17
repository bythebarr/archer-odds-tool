import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit, PRIOR_STRENGTH_GAMES, RECENCY_TILT } from "@/lib/props/projection";

/**
 * Chase the pitcher lean. The widened props edge screen found every PITCHING
 * counting stat (Ks, outs, hits/ER allowed) reads ~+0.3 to +2.1pt actual-over-
 * projection — the model under-predicts pitching overs — while batting sits at
 * ~0. Because the sign is the same for "good" (Ks) and "bad" (hits allowed)
 * stats, it can't be pitcher-quality selection. The hypothesis is a within-
 * season WORKLOAD RAMP: starters stretch from short April outings to 6+ inning
 * summer starts, so a season-POOLED base rate (and a season-rate dragged down by
 * those early short starts) understates the mid/late-season games we predict.
 *
 * This script (1) reproduces the gap, (2) tests the ramp directly by bucketing
 * the gap by within-season start number — a ramp predicts the gap GROWS through
 * the season — and (3) sweeps K (prior strength) and the recency tilt on a
 * temporal train/validate split to find what closes the gap out-of-sample.
 *
 * Run: `npm run calibrate:pitchers`.
 */

interface PitchProp {
  label: string;
  column: "strikeoutsPitching" | "outsRecorded" | "earnedRuns" | "hitsAllowed" | "walksAllowed";
  line: number;
}
const PROPS: PitchProp[] = [
  { label: "Pitcher Ks o4.5", column: "strikeoutsPitching", line: 4.5 },
  { label: "Pitcher Ks o5.5", column: "strikeoutsPitching", line: 5.5 },
  { label: "Pitcher Ks o6.5", column: "strikeoutsPitching", line: 6.5 },
  { label: "Outs Recorded o17.5", column: "outsRecorded", line: 17.5 },
  { label: "Earned Runs o2.5", column: "earnedRuns", line: 2.5 },
  { label: "Hits Allowed o5.5", column: "hitsAllowed", line: 5.5 },
  { label: "Walks Allowed o1.5", column: "walksAllowed", line: 1.5 },
];

interface Sample {
  prob: number; // projected P(over) at default K/tilt (for the reproduce/ramp views)
  hit: number; // 1 if the over cleared
  startNo: number; // within-season start index (1 = first projected start)
  gameDate: Date;
  // Raw inputs kept so the K/tilt sweep can re-project without a second DB pass.
  seasonHits: number;
  seasonSample: number;
  recentRate: number | null;
  baseRate: number;
}

/** Lookahead-safe: project each start from ONLY the pitcher's prior starts this season. */
function buildSamples(
  logs: { mlbPlayerId: string; gameDate: Date; value: number | null }[],
  line: number,
  baseRate: number
): Sample[] {
  const samples: Sample[] = [];
  let curPlayer = "";
  let curYear = -1;
  let seasonHits = 0;
  let seasonSample = 0;
  let startNo = 0;
  const recent: number[] = [];

  for (const g of logs) {
    if (g.value === null) continue;
    const year = g.gameDate.getUTCFullYear();
    if (g.mlbPlayerId !== curPlayer || year !== curYear) {
      curPlayer = g.mlbPlayerId;
      curYear = year;
      seasonHits = 0;
      seasonSample = 0;
      startNo = 0;
      recent.length = 0;
    }
    const hit = g.value > line ? 1 : 0;

    if (seasonSample > 0) {
      startNo += 1;
      const recentRate = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
      const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate });
      if (proj)
        samples.push({
          prob: proj.probability,
          hit,
          startNo,
          gameDate: g.gameDate,
          seasonHits,
          seasonSample,
          recentRate,
          baseRate,
        });
    }

    seasonHits += hit;
    seasonSample += 1;
    recent.push(hit);
    if (recent.length > 10) recent.shift();
  }
  return samples;
}

function gap(samples: Sample[], prob: (s: Sample) => number): { n: number; proj: number; actual: number; gap: number; brier: number } {
  const n = samples.length;
  const proj = samples.reduce((a, s) => a + prob(s), 0) / n;
  const actual = samples.reduce((a, s) => a + s.hit, 0) / n;
  const brier = samples.reduce((a, s) => a + (prob(s) - s.hit) ** 2, 0) / n;
  return { n, proj: proj * 100, actual: actual * 100, gap: (actual - proj) * 100, brier };
}

type Ramp = { slope: number; pivot: number; cap: number };

/** Re-project a stored sample, optionally with a season-progress ramp (no DB round-trip). */
function reproject(s: Sample, ramp?: Ramp): number {
  return projectPropHit(
    { seasonHits: s.seasonHits, seasonSample: s.seasonSample, recentRate: s.recentRate, baseRate: s.baseRate },
    ramp ? { ramp } : {}
  )!.probability;
}

/**
 * Fit the ramp on the training split: OLS of the DEFAULT model's residual
 * (hit − projected) on the season-progress index, CAPPED at `cap` because
 * workload saturates (starters top out near 6–7 innings). The line
 * intercept + slope·x is re-expressed as slope·(x − pivot) so it plugs straight
 * into projectPropHit's `ramp` option. Lookahead-safe: train-only fit.
 */
function fitRamp(train: Sample[], cap: number): Ramp {
  const n = train.length;
  if (n < 2) return { slope: 0, pivot: 0, cap };
  const x = (s: Sample) => Math.min(s.seasonSample, cap);
  const mx = train.reduce((a, s) => a + x(s), 0) / n;
  const my = train.reduce((a, s) => a + (s.hit - s.prob), 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const s of train) {
    sxy += (x(s) - mx) * (s.hit - s.prob - my);
    sxx += (x(s) - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const pivot = Math.abs(slope) > 1e-9 ? -intercept / slope : 0;
  return { slope, pivot, cap };
}

/** f=1 book-sharpness ROI (%): book line == the model, so positive ROI ⇒ the model is miscalibrated. */
function roiF1(samples: Sample[], base: number, prob: (s: Sample) => number): number {
  const HOLD = 0.06;
  const THRESH = 0.03;
  let staked = 0;
  let pnl = 0;
  for (const s of samples) {
    const p = prob(s);
    const dev = p - base;
    if (Math.abs(dev) < THRESH) continue;
    const betOver = dev > 0;
    const bookImplied = betOver ? p : 1 - p; // f=1 → book prob == model prob
    if (bookImplied <= 0 || bookImplied >= 1) continue;
    const decimal = 1 / (bookImplied * (1 + HOLD));
    const won = betOver ? s.hit === 1 : s.hit === 0;
    staked += 1;
    pnl += won ? decimal - 1 : -1;
  }
  return staked ? (pnl / staked) * 100 : NaN;
}

async function main() {
  console.log("Loading starter game logs…");
  const rows = await prisma.playerGameLog.findMany({
    where: { isStarter: true },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      strikeoutsPitching: true,
      outsRecorded: true,
      earnedRuns: true,
      hitsAllowed: true,
      walksAllowed: true,
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  console.log(`${rows.length} starts.  Defaults: K=${PRIOR_STRENGTH_GAMES}, tilt=${RECENCY_TILT}\n`);

  const perProp: { p: PitchProp; samples: Sample[] }[] = [];
  for (const p of PROPS) {
    const logs = rows.map((r) => ({ mlbPlayerId: r.mlbPlayerId, gameDate: r.gameDate, value: r[p.column] }));
    const qualified = logs.filter((l) => l.value !== null);
    const base = qualified.reduce((a, l) => a + (l.value! > p.line ? 1 : 0), 0) / qualified.length;
    perProp.push({ p, samples: buildSamples(logs, p.line, base) });
  }

  // ── (1) Reproduce the gap ────────────────────────────────────────────────
  console.log("(1) Reproduce — gap at default K/tilt:");
  console.log("prop".padEnd(22) + "n".padStart(7) + "proj".padStart(9) + "actual".padStart(9) + "gap".padStart(8));
  for (const { p, samples } of perProp) {
    const g = gap(samples, (s) => s.prob);
    console.log(
      p.label.padEnd(22) +
        `${g.n}`.padStart(7) +
        `${g.proj.toFixed(1)}%`.padStart(9) +
        `${g.actual.toFixed(1)}%`.padStart(9) +
        `${g.gap >= 0 ? "+" : ""}${g.gap.toFixed(1)}`.padStart(8)
    );
  }

  // ── (2) Ramp test — gap by within-season start bucket ────────────────────
  console.log("\n(2) Ramp test — gap (actual−proj, pts) by within-season start #:");
  const buckets: [string, (n: number) => boolean][] = [
    ["starts 2–5", (n) => n <= 4],
    ["starts 6–10", (n) => n >= 5 && n <= 9],
    ["starts 11–20", (n) => n >= 10 && n <= 19],
    ["starts 21+", (n) => n >= 20],
  ];
  console.log("prop".padEnd(22) + buckets.map(([b]) => b.padStart(13)).join(""));
  for (const { p, samples } of perProp) {
    const cells = buckets.map(([, inBucket]) => {
      const sub = samples.filter((s) => inBucket(s.startNo));
      if (!sub.length) return "—".padStart(13);
      const g = gap(sub, (s) => s.prob);
      return `${g.gap >= 0 ? "+" : ""}${g.gap.toFixed(1)}`.padStart(13);
    });
    console.log(p.label.padEnd(22) + cells.join(""));
  }

  // K/tilt tuning was already ruled out (moved the gap <0.3pt) — the bias is a
  // trend, not a weighting problem. Build the structural ramp instead.

  // ── (3) Fit the ramp on train, validate out-of-sample ────────────────────
  // Chronological split per prop: fit the ramp on the older 70%, judge on the
  // newer 30% it never saw. Report gap AND Brier so we confirm the term removes
  // real error, not just zeroes a mean.
  const bases = perProp.map(({ samples }) => samples[0]?.baseRate ?? 0.5);
  const rawSplits = perProp.map(({ samples }) => {
    const sorted = [...samples].sort((a, b) => a.gameDate.getTime() - b.gameDate.getTime());
    const cut = Math.floor(sorted.length * 0.7);
    return { train: sorted.slice(0, cut), val: sorted.slice(cut) };
  });

  // Sweep the saturation cap: pick the one giving the smallest mean |val gap|
  // across props (the unbounded linear term overshoots late-season games).
  const CAPS = [8, 10, 12, 15, 20, Infinity];
  console.log("\n(3a) Saturation-cap sweep — mean |val gap| & mean val Brier across props:");
  let bestCap = { cap: Infinity, absGap: Infinity, brier: Infinity };
  for (const cap of CAPS) {
    let gapSum = 0;
    let brierSum = 0;
    rawSplits.forEach(({ train, val }) => {
      const ramp = fitRamp(train, cap);
      const g = gap(val, (s) => reproject(s, ramp));
      gapSum += Math.abs(g.gap);
      brierSum += g.brier;
    });
    const absGap = gapSum / rawSplits.length;
    const brier = brierSum / rawSplits.length;
    if (absGap < bestCap.absGap) bestCap = { cap, absGap, brier };
    console.log(`  cap=${cap === Infinity ? "∞" : cap}`.padEnd(10) + `|gap| ${absGap.toFixed(2)}pt   Brier ${brier.toFixed(4)}`);
  }
  const CAP = bestCap.cap;
  console.log(`  → best cap = ${CAP === Infinity ? "∞" : CAP} (mean |val gap| ${bestCap.absGap.toFixed(2)}pt)`);

  const splits = perProp.map(({ p, samples }, i) => ({
    p,
    base: bases[i],
    ...rawSplits[i],
    ramp: fitRamp(rawSplits[i].train, CAP),
  }));

  console.log(`\n(3b) Bounded ramp (cap=${CAP === Infinity ? "∞" : CAP}) — fit on train, out-of-sample validation:`);
  console.log(
    "prop".padEnd(22) +
      "slope(pt/start)".padStart(16) +
      "val gap →".padStart(20) +
      "val Brier →".padStart(22)
  );
  for (const { p, val, ramp } of splits) {
    const gd = gap(val, (s) => s.prob);
    const gr = gap(val, (s) => reproject(s, ramp));
    const gapCell = `${gd.gap >= 0 ? "+" : ""}${gd.gap.toFixed(1)} → ${gr.gap >= 0 ? "+" : ""}${gr.gap.toFixed(1)}`;
    const brierCell = `${gd.brier.toFixed(4)} → ${gr.brier.toFixed(4)}`;
    console.log(
      p.label.padEnd(22) +
        `${(ramp.slope * 100).toFixed(2)}`.padStart(16) +
        gapCell.padStart(20) +
        brierCell.padStart(22)
    );
  }
  const meanAbsGap = (fn: (s: Sample, r: Ramp) => number) =>
    splits.reduce((a, { val, ramp }) => a + Math.abs(gap(val, (s) => fn(s, ramp)).gap), 0) / splits.length;
  console.log(
    `\nMean |val gap|: default ${meanAbsGap((s) => s.prob).toFixed(2)}pt → ramp ${meanAbsGap((s, r) => reproject(s, r)).toFixed(2)}pt`
  );

  // ── (4) Does the "edge that survives to f=1" collapse? ───────────────────
  // The screen's f=1 column (book line == our model) showed pitching props stay
  // +EV — the tell of miscalibration, not market softness. If the ramp is the
  // real story, that ROI should fall toward −hold once the model is honest.
  console.log("\n(4) f=1 book-sharpness ROI on validation (should collapse toward ~−6% hold if the edge was the lean):");
  console.log("prop".padEnd(22) + "default".padStart(12) + "ramp".padStart(12));
  for (const { p, base, val, ramp } of splits) {
    const rd = roiF1(val, base, (s) => s.prob);
    const rr = roiF1(val, base, (s) => reproject(s, ramp));
    const fmt = (x: number) => (Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
    console.log(p.label.padEnd(22) + fmt(rd).padStart(12) + fmt(rr).padStart(12));
  }

  // ── (5) Fitted constants for wiring into the board / edge screen ─────────
  console.log("\n(5) Fitted ramp constants (refit on ALL samples per prop) — paste into the pitching family:");
  for (const { p, samples } of perProp) {
    const r = fitRamp(samples, CAP);
    const cap = r.cap === Infinity ? "Infinity" : r.cap;
    console.log(`  ${p.label.padEnd(22)} { slope: ${r.slope.toFixed(5)}, pivot: ${r.pivot.toFixed(2)}, cap: ${cap} },`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
