/**
 * Plus-money alpha and contrarian-fade audit math (scripts/audit-plus-money.ts):
 * the buckets, the opposite-side lookup, chronological factor tests, slate and
 * player sensitivity, and the daily-shortlist feasibility read. Pure; the DB
 * work is in the script.
 */
import { decimalOf, impliedOf, logisticWithOffset, logit, rng, segmentPerf, sigmoid, type PerfRow } from "./performance";

/** Phase 2: the price ranges. */
export const PRICE_BUCKETS: { label: string; test: (american: number) => boolean }[] = [
  { label: "negative (−101 or shorter)", test: (a) => a < 100 },
  { label: "+100 to +124", test: (a) => a >= 100 && a < 125 },
  { label: "+125 to +149", test: (a) => a >= 125 && a < 150 },
  { label: "+150 to +174", test: (a) => a >= 150 && a < 175 },
  { label: "+175 to +199", test: (a) => a >= 175 && a < 200 },
  { label: "+200 and higher", test: (a) => a >= 200 },
];
/** Also read as one band. */
export const PLUS_100_175 = (a: number) => a >= 100 && a < 175;

/** Phase 3: |z| ranges (the projection's distance from the line in its own spread). Above Z_DEGENERATE is a collapsed spread, kept apart. */
export const Z_DEGENERATE = 6;
export const Z_BUCKETS: { label: string; test: (z: number) => boolean }[] = [
  { label: "|z| below 0.20", test: (z) => z < 0.2 },
  { label: "|z| 0.20–0.35", test: (z) => z >= 0.2 && z < 0.35 },
  { label: "|z| 0.35–0.55", test: (z) => z >= 0.35 && z < 0.55 },
  { label: "|z| 0.55–0.75", test: (z) => z >= 0.55 && z < 0.75 },
  { label: "|z| 0.75–1.00", test: (z) => z >= 0.75 && z < 1 },
  { label: "|z| 1.00–1.50", test: (z) => z >= 1 && z < 1.5 },
  { label: "|z| above 1.50", test: (z) => z >= 1.5 && z <= Z_DEGENERATE },
];
export const Z_035_075 = (z: number) => z >= 0.35 && z < 0.75;

/** A quote as the snapshot table stores it. */
export interface Quote {
  side: string;
  point: number;
  bookKey: string;
  priceAmerican: number;
  polledAt: Date;
}

export interface OppositeLookup {
  /** The latest quote on the OTHER side, same book, same line, polled at or before the decision; null when none was recorded. */
  opposite: Quote | null;
  /** The latest same-side quote at that moment, and whether its price equals the price recorded with the pick (identity check). */
  sameSide: Quote | null;
  identityOk: boolean | null;
  /** The last other-side quote before tip (for the fade's closing-line value). */
  closingOpposite: Quote | null;
  closingSame: Quote | null;
}

const latestAtOrBefore = (qs: Quote[], t: number) => qs.filter((q) => q.polledAt.getTime() <= t).reduce<Quote | null>((a, q) => (!a || q.polledAt > a.polledAt ? q : a), null);

/**
 * The opposite side of a pick, from quotes recorded for the same game, player
 * and stat: same book, same line, the other side, the latest poll at or before
 * the decision time. Nothing is reconstructed or assumed: no quote, no price.
 */
export function lookupOpposite(
  quotes: Quote[],
  pick: { side: "over" | "under"; point: number; bookKey: string; price: number | null; decidedAt: number; startsAt: number }
): OppositeLookup {
  const other = pick.side === "over" ? "under" : "over";
  const atLine = quotes.filter((q) => q.point === pick.point && q.bookKey === pick.bookKey);
  const opp = atLine.filter((q) => q.side === other);
  const same = atLine.filter((q) => q.side === pick.side);
  const sameSide = latestAtOrBefore(same, pick.decidedAt);
  return {
    opposite: latestAtOrBefore(opp, pick.decidedAt),
    sameSide,
    identityOk: sameSide === null || pick.price === null ? null : sameSide.priceAmerican === pick.price,
    closingOpposite: latestAtOrBefore(opp, pick.startsAt - 1),
    closingSame: latestAtOrBefore(same, pick.startsAt - 1),
  };
}

/** No-vig chance of side A from a two-sided pair (multiplicative, as lib/odds/devig). */
export const noVig = (priceA: number, priceB: number) => impliedOf(priceA) / (impliedOf(priceA) + impliedOf(priceB));

/**
 * A fade as a PerfRow: the opposite side at its own recorded price. It wins when
 * the pick lost (main lines are half-points here; pushes and voids are already
 * set aside). Its "market" is the no-vig chance of the opposite side from the
 * same recorded pair, and its close the same at the last pre-tip pair.
 */
export function fadeRow(
  pick: { cluster: string; day?: string; won: 0 | 1; p: number },
  oppPrice: number,
  samePrice: number,
  closing: { opp: number; same: number } | null
): PerfRow {
  return {
    cluster: pick.cluster,
    day: pick.day,
    won: pick.won ? 0 : 1,
    // ARCHR's chance on the opposite side.
    p: 1 - pick.p,
    market: noVig(oppPrice, samePrice),
    price: oppPrice,
    close: closing ? noVig(closing.opp, closing.same) : null,
  };
}

/** Per-row log loss. */
const ll = (p: number, y: number) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

export interface FactorRow {
  cluster: string;
  won: 0 | 1;
  /** The sportsbook's no-vig chance (the baseline every factor is judged against). */
  market: number;
  /** The factor(s), already scaled (one entry per factor; several = a combined model). */
  x: number[];
}

export interface ChronoResult {
  /** Fitted on the training rows only (the first factor's coefficient). */
  coef: number | null;
  trainN: number;
  testN: number;
  /** Test-set log loss: books only, and books + this factor (lower is better). */
  testLlBooks: number | null;
  testLlWith: number | null;
  /** Books minus with-factor, per pick ×1000, and its game-cluster bootstrap interval (> 0: the factor helped on unseen games). */
  gain: number | null;
  gainLo: number | null;
  gainHi: number | null;
  /** Share of bootstrap draws where the factor did NOT help: a one-sided noise probability. */
  pNoise: number | null;
}

/**
 * Does a factor add information beyond the books' price on games it never saw?
 * Fit won ~ offset(logit books) + b·x on the training rows, then compare log loss
 * on the test rows against the books alone. Chronological, never random.
 */
export function chronoFactorTest(train: FactorRow[], test: FactorRow[], seed = 23, boot = 400): ChronoResult {
  const base = { trainN: train.length, testN: test.length };
  const fit = train.length >= 50 ? logisticWithOffset(train.map((r) => ({ y: r.won, offset: logit(r.market), x: r.x }))) : null;
  if (!fit || !test.length) return { ...base, coef: fit?.[0] ?? null, testLlBooks: null, testLlWith: null, gain: null, gainLo: null, gainHi: null, pNoise: null };
  const lin = (r: FactorRow) => r.x.reduce((a, xi, i) => a + xi * fit[i]!, 0);
  const diffs = test.map((r) => ({ cluster: r.cluster, d: ll(r.market, r.won) - ll(sigmoid(logit(r.market) + lin(r)), r.won) }));
  const byGame = new Map<string, { s: number; n: number }>();
  for (const d of diffs) {
    const g = byGame.get(d.cluster) ?? byGame.set(d.cluster, { s: 0, n: 0 }).get(d.cluster)!;
    g.s += d.d;
    g.n++;
  }
  const games = [...byGame.values()];
  const next = rng(seed);
  const draws: number[] = [];
  for (let i = 0; i < boot && games.length >= 2; i++) {
    let s = 0;
    let n = 0;
    for (let j = 0; j < games.length; j++) {
      const g = games[Math.floor(next() * games.length)]!;
      s += g.s;
      n += g.n;
    }
    draws.push((s / n) * 1000);
  }
  draws.sort((a, z) => a - z);
  const mean = (diffs.reduce((a, d) => a + d.d, 0) / diffs.length) * 1000;
  return {
    ...base,
    coef: fit[0]!,
    testLlBooks: test.reduce((a, r) => a + ll(r.market, r.won), 0) / test.length,
    testLlWith: test.reduce((a, r) => a + ll(sigmoid(logit(r.market) + lin(r)), r.won), 0) / test.length,
    gain: mean,
    gainLo: draws.length ? draws[Math.floor(0.025 * draws.length)]! : null,
    gainHi: draws.length ? draws[Math.min(draws.length - 1, Math.floor(0.975 * draws.length))]! : null,
    pNoise: draws.length ? draws.filter((x) => x <= 0).length / draws.length : null,
  };
}

/** ROI with each slate day (or each player) left out in turn: the range shows whether one day carries the result. */
export function leaveOneOut<R extends PerfRow>(rows: R[], key: (r: R) => string): { key: string; roi: number | null; n: number }[] {
  const keys = [...new Set(rows.map(key))];
  return keys.map((k) => {
    const kept = rows.filter((r) => key(r) !== k);
    return { key: k, roi: segmentPerf(kept, 3, 0).roi, n: kept.length };
  });
}

/** The pick's biggest contributors: share of total profit from its top player (concentration). */
export function profitConcentration<R extends PerfRow>(rows: R[], key: (r: R) => string): { top: string | null; share: number | null } {
  const by = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.price === null) continue;
    const pr = r.won ? decimalOf(r.price) - 1 : -1;
    by.set(key(r), (by.get(key(r)) ?? 0) + pr);
    total += pr;
  }
  if (!by.size || total <= 0) return { top: null, share: null };
  const [top, v] = [...by].sort((a, b) => b[1] - a[1])[0]!;
  return { top, share: v / total };
}

export interface SlateFeasibility {
  days: number;
  /** Qualifying picks per slate day: median, min, max. */
  median: number;
  min: number;
  max: number;
  /** Days with at least k qualifying picks. */
  daysWithK: number;
  /** Distinct games among the qualifying picks per day (median). */
  medianGames: number;
}

/** How many picks meet a predeclared standard each slate day. */
export function slateFeasibility<R extends { day?: string; cluster: string }>(rows: R[], qualifies: (r: R) => boolean, k = 6): SlateFeasibility {
  const days = new Map<string, R[]>();
  for (const r of rows) if (r.day) (days.get(r.day) ?? days.set(r.day, []).get(r.day)!).push(r);
  const counts: number[] = [];
  const games: number[] = [];
  for (const list of days.values()) {
    const q = list.filter(qualifies);
    counts.push(q.length);
    games.push(new Set(q.map((r) => r.cluster)).size);
  }
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
  };
  return { days: counts.length, median: med(counts), min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, daysWithK: counts.filter((c) => c >= k).length, medianGames: med(games) };
}

/**
 * Do picks in the same game win and lose together beyond what their chances
 * say? The average correlation of (won − chance) residuals between pairs of
 * picks in the same game, against pairs from different games on the same day.
 */
export function residualCorrelation(rows: { cluster: string; day?: string; won: 0 | 1; market: number | null; p: number }[]): { sameGame: number | null; sameGamePairs: number; otherGame: number | null; otherGamePairs: number } {
  const res = rows.map((r) => ({ g: r.cluster, d: r.day ?? "", e: r.won - (r.market ?? r.p), v: (r.market ?? r.p) * (1 - (r.market ?? r.p)) }));
  let sg = 0;
  let sgn = 0;
  let og = 0;
  let ogn = 0;
  const byDay = new Map<string, typeof res>();
  for (const r of res) (byDay.get(r.d) ?? byDay.set(r.d, []).get(r.d)!).push(r);
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const c = (a.e * b.e) / Math.sqrt(a.v * b.v);
        if (a.g === b.g) {
          sg += c;
          sgn++;
        } else {
          og += c;
          ogn++;
        }
      }
  }
  return { sameGame: sgn ? sg / sgn : null, sameGamePairs: sgn, otherGame: ogn ? og / ogn : null, otherGamePairs: ogn };
}
