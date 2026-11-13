/**
 * DIAGNOSIS ONLY — a continuous-factor variant of the Confidence score, for
 * scripts/backtest-confidence.ts to compare against the live one. Nothing in
 * the product imports this: the grade every surface shows is still
 * lib/propModel/confidence's confidenceOf, unchanged.
 *
 * The live score moves in steps: distance is −10 / 0 / +10 at |z| bands, the
 * market gap +5 only inside 8–15 pts, sample −20 / −10 / 0 / +5 by game-count
 * buckets, and the track record a flat +10 / −5 by verdict word. Steps pile
 * the board onto a handful of scores. This variant keeps every factor's range
 * and replaces those four steps with straight lines through the same anchors:
 *
 *   distance  linear in |z|: −10 at |z| ≤ 0.15, 0 at 0.55, +10 at |z| ≥ 0.95,
 *             with z capped at Z_CAP and a degenerate input guarded (below)
 *   market    the 8–15 pt "real disagreement" bump as a tent (0 at 3 pts, +5 at
 *             11.5, 0 at 15) and the past-15 cost growing with the gap (−15 by 22)
 *   sample    linear in games: −20 at ≤ 2, −10 at 7.5, 0 at 15, +5 at ≥ 30
 *   track     the report card's own record, not its verdict word: skill in
 *             Brier points ×1000 (base-rate Brier − Brier), clamped to −5..+10 and
 *             scaled by how many outcomes graded it (full weight at 500); no
 *             card stays −5, a sport with no blend stays 0
 *
 * Every other factor (record, side, minutes, injury, alt line, price) is
 * the live one, untouched. Same BASE, same cuts (A 75 / B 60 / C 45).
 *
 * THE Z GUARD. z = (mean − line) / sd, and the callers floor sd at 1e-6. A
 * projection whose spread collapses to ~0 (a player with near-identical games,
 * or a zero-variance fallback) turns a 0.5 gap into z ≈ 500,000, and the live
 * distance factor reads it as "sits well off the line (499421.22 of a typical
 * swing)" and adds +10. Here |z| above Z_DEGENERATE is treated as a degenerate
 * input: no distance credit, and the reason says so. Within range, |z| is
 * capped at Z_CAP before it scores. Pure.
 */
import { BASE, confidenceOf, gradeOf, type Confidence, type ConfidenceFactor, type ConfidenceInput } from "./confidence";
import { bucketStats, type BucketStats, type ScoredOutcome } from "./confidenceDiagnosis";

/** |z| beyond this is a collapsed projection spread, not distance. */
export const Z_DEGENERATE = 6;
/** Within range, |z| is capped here before it scores (the factor tops out at 0.95 anyway). */
export const Z_CAP = 2.5;
/** Outcomes graded for a report card's record to count in full. */
export const TRACK_FULL_N = 500;

/** Straight lines between anchor points, flat past the ends. */
export function interp(x: number, points: [number, number][]): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x0, y0] = points[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1]![1];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Distance from the line, continuous; null input (no projection) is no factor. Degenerate z earns nothing. */
export function distanceEffect(z: number | null | undefined): { effect: number; degenerate: boolean } | null {
  if (z === null || z === undefined) return null;
  const a = Math.abs(z);
  if (!Number.isFinite(a) || a > Z_DEGENERATE) return { effect: 0, degenerate: true };
  return { effect: round1(interp(Math.min(a, Z_CAP), [[0.15, -10], [0.55, 0], [0.95, 10]])), degenerate: false };
}

/** ARCHR minus the books' chance, continuous: the sweet-spot tent and the growing cost past 15 pts. */
export function marketEffect(gap: number): number {
  return round1(interp(gap, [[0.03, 0], [0.115, 5], [0.15, 0], [0.22, -15]]));
}

/** Games of history, continuous. */
export function sampleEffect(games: number): number {
  return round1(interp(games, [[2, -20], [7.5, -10], [15, 0], [30, 5]]));
}

export interface TrackCard {
  /** Base-rate Brier minus Brier (positive = better than no skill). */
  skill: number;
  /** Outcomes the card was graded on. */
  n: number;
}

/** The report card's actual record: skill ×1000 clamped to −5..+10, weighted by sample. Missing card −5; no blend for the sport 0. */
export function trackEffect(verdict: string | null | undefined, card: TrackCard | null | undefined): number {
  if (verdict === undefined) return 0;
  if (!card) return -5;
  const raw = Math.max(-5, Math.min(10, card.skill * 1000));
  return round1(raw * Math.min(1, card.n / TRACK_FULL_N));
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

/**
 * The continuous variant of one prop's Confidence: the live factors with
 * distance, market, sample and track re-scored as above. `card` is the stat's
 * report-card record (null: no card).
 */
export function continuousConfidenceOf(c: ConfidenceInput, card?: TrackCard | null): Confidence | null {
  const live = confidenceOf(c);
  if (!live) return null;
  const books = c.marketChance ?? (c.priceAmerican !== null ? implied(c.priceAmerican) : null);
  const factors: ConfidenceFactor[] = live.factors.map((f) => {
    if (f.key === "distance") {
      const d = distanceEffect(c.z)!;
      return d.degenerate
        ? { ...f, effect: 0, text: `Distance not scored: the projection's spread is ~0, so z (${Math.abs(c.z!).toExponential(1)}) is a degenerate input, not distance.` }
        : { ...f, effect: d.effect, text: `${f.text.split(":")[0]} (continuous, |z| ${Math.min(Math.abs(c.z!), Z_CAP).toFixed(2)})` };
    }
    if (f.key === "market" && books !== null) return { ...f, effect: marketEffect(c.archr! - books), text: `${f.text.split(":")[0]} (continuous)` };
    if (f.key === "sample") return { ...f, effect: sampleEffect(c.sampleGames), text: `${c.sampleGames} games of history (continuous)` };
    if (f.key === "track") return { ...f, effect: trackEffect(c.blendVerdict, card), text: card ? `Report card: skill ${(card.skill * 1000).toFixed(1)} on ${card.n} graded (continuous)` : f.text };
    return f;
  });
  const score = Math.max(0, Math.min(100, round1(BASE + factors.reduce((s, x) => s + x.effect, 0))));
  return { score, grade: gradeOf(score), factors };
}

/** Distinct scores, how they spread, the share at each grade and the top score. */
export function scoreProfile(scores: number[]) {
  const distinct = new Set(scores).size;
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  for (const s of scores) grades[gradeOf(s)]++;
  const share = Object.fromEntries(Object.entries(grades).map(([g, n]) => [g, scores.length ? n / scores.length : 0])) as Record<keyof typeof grades, number>;
  return { n: scores.length, distinct, max: scores.length ? Math.max(...scores) : NaN, grades, share, aReachable: scores.some((s) => s >= 75) };
}

/** 10-point score buckets with outcomes (hit rate vs ARCHR, Brier, ROI of the positive-edge bets at the price). */
export function tenPointBuckets(rows: ScoredOutcome[]): BucketStats[] {
  const out: BucketStats[] = [];
  for (let lo = 0; lo < 100; lo += 10) {
    const set = rows.filter((r) => r.score >= lo && (lo === 90 ? r.score <= 100 : r.score < lo + 10));
    if (set.length) out.push(bucketStats(`${lo}–${lo + 9}`, set));
  }
  return out;
}

/** Spearman rank correlation. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      for (let k = i; k <= j; k++) r[order[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const m = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mx = m(rx);
  const my = m(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** Buckets need this many positive-edge bets for their ROI to count in the calibration check. */
export const MIN_BUCKET_BETS = 30;

export interface Separation {
  /** Buckets with enough edge bets to read. */
  used: number;
  /** Rank correlation of bucket order vs realized ROI (+1: ROI rises with every bucket). */
  rho: number | null;
  /** ROI of the positive-edge bets in the top half of the scored rows vs the bottom half. */
  highRoi: number | null;
  lowRoi: number | null;
  highBets: number;
  lowBets: number;
  verdict: "separates" | "does not separate" | "too few bets to say";
  reason: string;
}

/**
 * Does the score PREDICT? Higher buckets have to earn better realized ROI. Reads
 * the rank correlation of bucket vs ROI (buckets with MIN_BUCKET_BETS+ edge
 * bets) and the top-half vs bottom-half ROI split by score. "separates" needs
 * both: rho ≥ 0.5 over 3+ buckets and the top half's ROI above the bottom
 * half's. Anything else says plainly that it doesn't.
 */
export function separation(rows: ScoredOutcome[]): Separation {
  const buckets = tenPointBuckets(rows).filter((b) => b.edgeBets >= MIN_BUCKET_BETS && b.edgeRoi !== null);
  const rho = buckets.length >= 3 ? spearman(buckets.map((_, i) => i), buckets.map((b) => b.edgeRoi!)) : null;
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const half = Math.floor(sorted.length / 2);
  const low = bucketStats("low half", sorted.slice(0, half));
  const high = bucketStats("high half", sorted.slice(half));
  const base = { used: buckets.length, rho, highRoi: high.edgeRoi, lowRoi: low.edgeRoi, highBets: high.edgeBets, lowBets: low.edgeBets };
  if (rho === null || high.edgeBets < MIN_BUCKET_BETS || low.edgeBets < MIN_BUCKET_BETS)
    return { ...base, verdict: "too few bets to say", reason: `needs ${MIN_BUCKET_BETS}+ positive-edge bets in 3+ buckets and in each half (buckets read: ${buckets.length}; bets ${low.edgeBets} low / ${high.edgeBets} high)` };
  const ok = rho >= 0.5 && (high.edgeRoi ?? -Infinity) > (low.edgeRoi ?? Infinity);
  return {
    ...base,
    verdict: ok ? "separates" : "does not separate",
    reason: ok
      ? `ROI rises with the score (rank correlation ${rho.toFixed(2)} over ${buckets.length} buckets) and the top half beats the bottom half`
      : `the score does not separate outcomes: rank correlation ${rho.toFixed(2)} over ${buckets.length} buckets; top-half ROI ${((high.edgeRoi ?? 0) * 100).toFixed(1)}% vs bottom-half ${((low.edgeRoi ?? 0) * 100).toFixed(1)}%`,
  };
}

/** The rows whose score moves most between two scorings, biggest move first. */
export function biggestMovers<T>(rows: { row: T; before: Confidence; after: Confidence }[], k = 5) {
  return [...rows].sort((a, b) => Math.abs(b.after.score - b.before.score) - Math.abs(a.after.score - a.before.score)).slice(0, k);
}
