/**
 * Soft-book lag (diagnostic only; nothing here prices, gates or shows a bet).
 * Question: when Pinnacle moves and a retail ("soft") book hasn't caught up,
 * does betting the stale soft price win?
 *
 * Pinnacle and the retail books are polled on different schedules, so each
 * soft quote at poll P on side X is compared with Pinnacle's latest quote at
 * or before P (no older than PIN_MAX_AGE_MIN). A lag bet fires when:
 *
 *   1. Pinnacle MOVED toward X since its previous poll:
 *      - same number: its no-vig chance on X rose by ≥ MOVE_PROB; or
 *      - the number moved against X (spread −3 → −3.5 for X, total up for
 *        the over).
 *      The move happened at Pinnacle's `sourceLastUpdate` at P.
 *   2. The soft book has NOT caught up within LAG_WINDOW_MIN: its own
 *      `sourceLastUpdate` is before Pinnacle's move, and P is at least
 *      LAG_WINDOW_MIN after the move.
 *   3. The soft quote is still on the old side of the move: at the same
 *      number, its price beats Pinnacle's new no-vig chance (positive EV
 *      against it); after a number move, it still offers the better number.
 *
 * One bet per game × market × side × book: the first poll where it fires.
 * The stale soft price is bet flat (1 unit). Pure; the script supplies rows.
 */
import { americanToDecimal, americanToImpliedProbability } from "@/lib/odds/americanOdds";
import { devigPair } from "@/lib/odds/devig";

/** Pinnacle's no-vig chance on a side must rise at least this much: 1.2 pts ≈ 5 cents at −110 (−110 → −115). */
export const MOVE_PROB = 0.012;
/** A soft quote still older than Pinnacle's move this long after it is stale, not feed jitter: retail books usually follow within minutes. */
export const LAG_WINDOW_MIN = 10;
/** Buckets under this many bets are thin: printed, never a verdict. */
export const MIN_VERDICT = 50;

export const SHARP_BOOK = "pinnacle";
export const SOFT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "espnbet", "fanatics", "betrivers", "hardrock", "bet365"] as const;

export type Market = "h2h" | "spreads" | "totals";
export type SideKey = "home" | "away" | "over" | "under";

export interface Quote {
  book: string;
  side: SideKey;
  point: number | null;
  price: number;
  polledAt: Date;
  sourceLastUpdate: Date;
}

export interface LagBet {
  book: string;
  side: SideKey;
  point: number | null;
  price: number;
  polledAt: Date;
  /** Minutes from Pinnacle's move to the poll that caught the stale quote. */
  lagMin: number;
  kind: "price" | "number";
  /** Same-number bets: EV of the stale price at Pinnacle's new no-vig chance. Number moves: null. */
  ev: number | null;
  /** Number moves: how many points better than Pinnacle's new number. Price moves: null. */
  pointsBetter: number | null;
  /** Pinnacle's no-vig chance on the side after the move (same-number bets). */
  pinFair: number | null;
  staleBy: StaleBy;
}

const PAIRS: Record<Market, [SideKey, SideKey]> = { h2h: ["home", "away"], spreads: ["home", "away"], totals: ["over", "under"] };
const other = (m: Market, s: SideKey): SideKey => (PAIRS[m][0] === s ? PAIRS[m][1] : PAIRS[m][0]);

interface PinPoll {
  t: number;
  update: number;
  quotes: Map<SideKey, Quote>;
}

/** For one side: a better number for the bettor is a higher point on spreads (−3 beats −3.5), lower on overs, higher on unders. */
function betterBy(m: Market, s: SideKey, soft: number, pin: number): number {
  if (m === "spreads") return soft - pin;
  if (m === "totals") return s === "over" ? pin - soft : soft - pin;
  return 0;
}

/** Whether the number moved against side X (toward X being more likely), and by how much. */
function numberMovedToward(m: Market, s: SideKey, before: number, after: number): number {
  if (m === "spreads") return before - after; // −3 → −3.5 for X: X is now a bigger favourite
  if (m === "totals") return s === "over" ? after - before : before - after;
  return 0;
}

/** Pinnacle's latest quote must be at most this old at the soft poll: an older one no longer says where the sharp market is. */
export const PIN_MAX_AGE_MIN = 360;

/** How a stale soft quote was established: its own update time, or the same quote already on the board before the move. */
export type StaleBy = "own update time" | "unchanged since before the move";

/** Every lag bet in one game × market, from all its pre-game quotes (Pinnacle and soft books, on any poll schedule). */
export function findLagBets(market: Market, quotes: Quote[]): LagBet[] {
  const [a, b] = PAIRS[market];
  // Pinnacle polls with both sides quoted.
  const pinByPoll = new Map<number, Map<SideKey, Quote>>();
  for (const q of quotes.filter((x) => x.book === SHARP_BOOK)) {
    const t = q.polledAt.getTime();
    (pinByPoll.get(t) ?? pinByPoll.set(t, new Map()).get(t)!).set(q.side, q);
  }
  const pinPolls: PinPoll[] = [...pinByPoll]
    .filter(([, m]) => m.has(a) && m.has(b))
    .sort((x, y) => x[0] - y[0])
    .map(([t, m]) => ({ t, update: Math.max(m.get(a)!.sourceLastUpdate.getTime(), m.get(b)!.sourceLastUpdate.getTime()), quotes: m }));
  if (pinPolls.length < 2) return [];

  // Each soft book × side's quotes in time order, for the "unchanged since before the move" check.
  const softSeries = new Map<string, Quote[]>();
  for (const q of quotes.filter((x) => x.book !== SHARP_BOOK)) {
    const k = `${q.book}|${q.side}`;
    (softSeries.get(k) ?? softSeries.set(k, []).get(k)!).push(q);
  }
  for (const s of softSeries.values()) s.sort((x, y) => x.polledAt.getTime() - y.polledAt.getTime());

  const out: LagBet[] = [];
  for (const series of softSeries.values()) {
    const side = series[0].side;
    if (side !== a && side !== b) continue;
    for (let j = 0; j < series.length; j++) {
      const soft = series[j];
      const P = soft.polledAt.getTime();
      // Pinnacle's latest poll at or before P, and the one before it.
      let ci = -1;
      for (let i = pinPolls.length - 1; i >= 0; i--) if (pinPolls[i].t <= P) { ci = i; break; }
      if (ci < 1) continue;
      const cur = pinPolls[ci];
      const prev = pinPolls[ci - 1];
      if (P - cur.t > PIN_MAX_AGE_MIN * 60_000) continue;
      const moveAt = cur.update;
      if (P - moveAt < LAG_WINDOW_MIN * 60_000) continue; // too soon after the move to call anything stale

      const pNow = cur.quotes.get(side)!;
      const pBefore = prev.quotes.get(side)!;
      const pOtherNow = cur.quotes.get(other(market, side))!;
      const pOtherBefore = prev.quotes.get(other(market, side))!;
      const fairNow = devigPair(pNow.price, pOtherNow.price).fairA;
      let kind: LagBet["kind"] | null = null;
      if (pNow.point === pBefore.point && pOtherNow.point === pOtherBefore.point) {
        if (fairNow - devigPair(pBefore.price, pOtherBefore.price).fairA >= MOVE_PROB) kind = "price";
      } else if (pNow.point !== null && pBefore.point !== null && numberMovedToward(market, side, pBefore.point, pNow.point) > 0) {
        kind = "number";
      }
      if (!kind) continue;

      // Has the soft book caught up? Its own update time says so when it has one; otherwise the same
      // quote must already have been on the board before Pinnacle moved, unchanged through P.
      const ownStamp = Math.abs(soft.sourceLastUpdate.getTime() - P) >= 1000;
      let staleBy: StaleBy | null = null;
      if (ownStamp) {
        if (soft.sourceLastUpdate.getTime() < moveAt) staleBy = "own update time";
      } else {
        let k = j;
        while (k > 0 && series[k - 1].point === soft.point && series[k - 1].price === soft.price) k--;
        if (series[k].polledAt.getTime() <= moveAt) staleBy = "unchanged since before the move";
      }
      if (!staleBy) continue;

      let ev: number | null = null;
      let pointsBetter: number | null = null;
      if (kind === "price") {
        if (soft.point !== pNow.point) continue;
        ev = fairNow * americanToDecimal(soft.price) - 1;
        if (ev <= 0) continue; // the stale price is no better than Pinnacle's new fair: nothing to take
      } else {
        if (soft.point === null || pNow.point === null) continue;
        pointsBetter = betterBy(market, side, soft.point, pNow.point);
        if (pointsBetter <= 0) continue;
        if (soft.price < pNow.price - 15) continue; // a better number bought back with a much worse price isn't stale
      }
      out.push({ book: soft.book, side, point: soft.point, price: soft.price, polledAt: soft.polledAt, lagMin: Math.round((P - moveAt) / 60_000), kind, ev, pointsBetter, pinFair: kind === "price" ? fairNow : null, staleBy });
      break; // one bet per game × market × side × book: the first poll it fires
    }
  }
  return out.sort((x, y) => x.polledAt.getTime() - y.polledAt.getTime());
}

/** Settles a bet from the final score at the bet's own number (hit / miss / push). */
export function settle(market: Market, side: SideKey, point: number | null, home: number, away: number): "hit" | "miss" | "push" {
  if (market === "h2h") {
    if (home === away) return "push";
    return (side === "home") === home > away ? "hit" : "miss";
  }
  if (point === null) throw new Error("spread/total bet without a number");
  const margin = market === "spreads" ? (side === "home" ? home - away : away - home) + point : side === "over" ? home + away - point : point - (home + away);
  return margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
}

export interface SettledBet extends LagBet {
  sport: string;
  market: Market;
  result: "hit" | "miss" | "push";
  /** Implied chance at the close minus at the bet (+ = the bet beat the close); null without a closing line at the same number. */
  clv: number | null;
}

export interface BucketStats {
  label: string;
  n: number;
  hitRate: number;
  roi: number;
  roiLow: number;
  roiHigh: number;
  clv: number | null;
  clvN: number;
  thin: boolean;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function profit(b: { result: "hit" | "miss" | "push"; price: number }): number {
  return b.result === "push" ? 0 : b.result === "hit" ? americanToDecimal(b.price) - 1 : -1;
}

export function bucketStats(label: string, bets: SettledBet[]): BucketStats {
  const p = bets.map(profit);
  const roi = mean(p);
  const sd = p.length > 1 ? Math.sqrt(p.reduce((a, v) => a + (v - roi) ** 2, 0) / (p.length - 1)) : Infinity;
  const half = 1.96 * (sd / Math.sqrt(Math.max(p.length, 1)));
  const decided = bets.filter((b) => b.result !== "push");
  const clvs = bets.map((b) => b.clv).filter((x): x is number => x !== null);
  return {
    label,
    n: bets.length,
    hitRate: decided.length ? decided.filter((b) => b.result === "hit").length / decided.length : NaN,
    roi,
    roiLow: roi - half,
    roiHigh: roi + half,
    clv: clvs.length ? mean(clvs) : null,
    clvN: clvs.length,
    thin: bets.length < MIN_VERDICT,
  };
}

export const clvOf = (betPrice: number, closePrice: number) => americanToImpliedProbability(closePrice) - americanToImpliedProbability(betPrice);

/** The lag-size bucket: how far the stale price sits from Pinnacle's new number. */
export function lagSize(b: LagBet): string {
  if (b.kind === "number") return b.pointsBetter! >= 1 ? "number: 1+ pt better" : "number: 0.5 pt better";
  if (b.ev! >= 0.05) return "price: EV 5%+";
  if (b.ev! >= 0.02) return "price: EV 2–5%";
  return "price: EV 0–2%";
}

/** The verdict over all bets: does the stale soft price win, and by how much? */
export function verdict(all: BucketStats): string {
  if (all.thin) return `THIN — only ${all.n} lag bets (needs ${MIN_VERDICT}+): no verdict`;
  const r = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  if (all.roiLow > 0) return `THE STALE SOFT PRICE WINS: ${r(all.roi)} ROI on ${all.n} bets, 95% interval [${r(all.roiLow)}, ${r(all.roiHigh)}] — above zero`;
  if (all.roiHigh < 0) return `THE STALE SOFT PRICE LOSES: ${r(all.roi)} ROI on ${all.n} bets, 95% interval [${r(all.roiLow)}, ${r(all.roiHigh)}] — below zero`;
  return `NOT DISTINGUISHABLE FROM ZERO: ${r(all.roi)} ROI on ${all.n} bets, 95% interval [${r(all.roiLow)}, ${r(all.roiHigh)}] spans zero`;
}
