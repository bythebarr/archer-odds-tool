/**
 * The z pocket (scripts/audit-factors.ts): where on the projection's distance
 * from the line — |z| = |projection − line| / its spread — ARCHR's
 * positive-edge bets actually pay, in fine buckets, with the volume each
 * candidate threshold keeps. Measures; picks nothing. Pure.
 */

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const payout = (american: number) => (american > 0 ? american / 100 : 100 / -american);

export interface ZSample {
  /** ARCHR's chance on the side. */
  p: number;
  /** The price the bet is settled at (closing, in the backtests). */
  price: number | null;
  won: 0 | 1;
  /** Signed z toward the side; null without a projection. */
  z: number | null;
  /** ISO date, for the earlier/later halves. */
  date: string;
}

/** |z| above this is a collapsed projection spread (yes/no props), not distance: reported apart. */
export const Z_DEGENERATE = 6;

export const Z_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "0–0.15", lo: 0, hi: 0.15 },
  { label: "0.15–0.35", lo: 0.15, hi: 0.35 },
  { label: "0.35–0.55", lo: 0.35, hi: 0.55 },
  { label: "0.55–0.65", lo: 0.55, hi: 0.65 },
  { label: "0.65–0.75", lo: 0.65, hi: 0.75 },
  { label: "0.75–0.85", lo: 0.75, hi: 0.85 },
  { label: "0.85–0.95", lo: 0.85, hi: 0.95 },
  { label: "0.95–1.25", lo: 0.95, hi: 1.25 },
  { label: "1.25+", lo: 1.25, hi: Z_DEGENERATE },
  { label: "degenerate (>6)", lo: Z_DEGENERATE, hi: Infinity },
];

/** The candidate floors a gate could sit at (keep |z| ≥ floor). */
export const Z_FLOORS = [0, 0.35, 0.55, 0.65, 0.75, 0.85, 0.95, 1.25];
/** And the candidate ceilings (also drop |z| ≥ ceiling); Infinity = none. */
export const Z_CEILINGS = [Infinity, 2.5, 1.25];

export interface RoiStats {
  /** Positive-edge bets (ARCHR's chance above the price's implied chance). */
  n: number;
  /** Flat-stake ROI; null with no bets. */
  roi: number | null;
  /** 95% interval on the ROI (normal approximation over per-bet returns). */
  lo: number | null;
  hi: number | null;
}

/** ARCHR's positive-edge, priced, non-degenerate-or-not bets in a set. */
export const edgeBets = (rows: ZSample[]) => rows.filter((r) => r.price !== null && r.z !== null && r.p > implied(r.price));

export function roiStats(rows: ZSample[]): RoiStats {
  const bets = edgeBets(rows);
  if (!bets.length) return { n: 0, roi: null, lo: null, hi: null };
  const rets = bets.map((b) => (b.won ? payout(b.price!) : -1));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const se = sd / Math.sqrt(rets.length);
  return { n: bets.length, roi: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

/** Earlier and later halves by date (ties go to the earlier half), as the factor audit splits. */
export function halves<T extends { date: string }>(rows: T[]): [T[], T[]] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.ceil(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}

export interface Cell {
  label: string;
  all: RoiStats;
  early: RoiStats;
  late: RoiStats;
}

};

const absZ = (r: ZSample) => Math.abs(r.z!);

/** ROI and bets per fine |z| bucket, both halves. Halves are split over the whole set, so a bucket's halves share dates with every other bucket's. */
export function bucketSweep(rows: ZSample[]): Cell[] {
  const withZ = rows.filter((r) => r.z !== null && Number.isFinite(r.z));
  const [early, late] = halves(withZ);
  const inB = (b: (typeof Z_BUCKETS)[number]) => (r: ZSample) => absZ(r) >= b.lo && absZ(r) < b.hi;
  return Z_BUCKETS.map((b) => ({ label: b.label, all: roiStats(withZ.filter(inB(b))), early: roiStats(early.filter(inB(b))), late: roiStats(late.filter(inB(b))) }));
}

export interface Threshold extends Cell {
  floor: number;
  ceiling: number;
  /** Share of all (non-degenerate) edge bets this threshold keeps. */
  kept: number;
}

/** Every floor × ceiling candidate: the bets it keeps, their ROI and both halves. Degenerate z is always out. */
export function thresholdSweep(rows: ZSample[]): Threshold[] {
  const usable = rows.filter((r) => r.z !== null && Number.isFinite(r.z) && Math.abs(r.z) <= Z_DEGENERATE);
  const total = edgeBets(usable).length;
  const [early, late] = halves(usable);
  const out: Threshold[] = [];
  for (const ceiling of Z_CEILINGS)
    for (const floor of Z_FLOORS) {
      if (floor >= ceiling) continue;
      const keep = (r: ZSample) => absZ(r) >= floor && absZ(r) < ceiling;
      const all = roiStats(usable.filter(keep));
      out.push({
        label: `${floor}${ceiling === Infinity ? "+" : `–${ceiling}`}`,
        floor,
        ceiling,
        all,
        early: roiStats(early.filter(keep)),
        late: roiStats(late.filter(keep)),
        kept: total ? all.n / total : 0,
      });
    }
  return out;
}

/** Bets a half needs before its ROI counts toward "holds in both halves". */
export const MIN_HALF_BETS = 30;

/**
 * The floor where ROI turns positive and stays positive: the lowest floor
 * (no ceiling) from which every fine bucket at or above it, with enough bets,
 * returns ≥ 0 in both halves. Null when no floor qualifies.
 */
export function stablePositiveFloor(buckets: Cell[]): number | null {
  const real = buckets.filter((b) => b.label !== "degenerate (>6)");
  for (let i = 0; i < real.length; i++) {
    const rest = real.slice(i).filter((b) => b.early.n >= MIN_HALF_BETS && b.late.n >= MIN_HALF_BETS);
    if (rest.length && rest.every((b) => (b.early.roi ?? -1) >= 0 && (b.late.roi ?? -1) >= 0)) return Z_BUCKETS[i]!.lo;
  }
  return null;
}
