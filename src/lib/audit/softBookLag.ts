/**
 * Soft-book lag (diagnostic only; nothing here prices, gates or shows a bet).
 * Question: when Pinnacle moves and a retail ("soft") book hasn't caught up,
 * does betting the stale soft price win?
 *
 * Every poll stores every book's quote at the same `polledAt`, with each
 * book's own `sourceLastUpdate`. A lag bet fires at a poll P on side X when:
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

/** Every lag bet in one game × market, from all its pre-game quotes (Pinnacle and soft books). */
export function findLagBets(market: Market, quotes: Quote[]): LagBet[] {
  const polls = [...new Set(quotes.map((q) => q.polledAt.getTime()))].sort((a, b) => a - b);
  const byPoll = new Map<number, Quote[]>();
  for (const q of quotes) (byPoll.get(q.polledAt.getTime()) ?? byPoll.set(q.polledAt.getTime(), []).get(q.polledAt.getTime())!).push(q);

  const pinPolls: PinPoll[] = [];
  for (const t of polls) {
    const pin = byPoll.get(t)!.filter((q) => q.book === SHARP_BOOK);
    const [a, b] = PAIRS[market];
    const qa = pin.find((q) => q.side === a);
    const qb = pin.find((q) => q.side === b);
    if (!qa || !qb) continue;
    pinPolls.push({ t, update: Math.max(qa.sourceLastUpdate.getTime(), qb.sourceLastUpdate.getTime()), quotes: new Map([[a, qa], [b, qb]]) });
  }

  const out: LagBet[] = [];
  const taken = new Set<string>();
  for (let i = 1; i < pinPolls.length; i++) {
    const prev = pinPolls[i - 1];
    const cur = pinPolls[i];
    const moveAt = cur.update;
    if (cur.t - moveAt < LAG_WINDOW_MIN * 60_000) continue; // too soon after the move to call anything stale
    for (const side of PAIRS[market]) {
      const pNow = cur.quotes.get(side)!;
      const pBefore = prev.quotes.get(side)!;
      const pOtherNow = cur.quotes.get(other(market, side))!;
      const pOtherBefore = prev.quotes.get(other(market, side))!;
      const fairNow = devigPair(pNow.price, pOtherNow.price).fairA;

      let kind: LagBet["kind"] | null = null;
      if (pNow.point === pBefore.point && pOtherNow.point === pOtherBefore.point) {
        const fairBefore = devigPair(pBefore.price, pOtherBefore.price).fairA;
        if (fairNow - fairBefore >= MOVE_PROB) kind = "price";
      } else if (pNow.point !== null && pBefore.point !== null && numberMovedToward(market, side, pBefore.point, pNow.point) > 0) {
        kind = "number";
      }
      if (!kind) continue;

      for (const soft of byPoll.get(cur.t)!.filter((q) => q.book !== SHARP_BOOK && q.side === side)) {
        const key = `${soft.book}|${side}`;
        if (taken.has(key)) continue;
        if (soft.sourceLastUpdate.getTime() >= moveAt) continue; // the soft book updated after the move: caught up
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
        taken.add(key);
        out.push({ book: soft.book, side, point: soft.point, price: soft.price, polledAt: soft.polledAt, lagMin: Math.round((cur.t - moveAt) / 60_000), kind, ev, pointsBetter, pinFair: kind === "price" ? fairNow : null });
      }
    }
  }
  return out;
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
