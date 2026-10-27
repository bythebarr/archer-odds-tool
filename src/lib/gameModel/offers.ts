/**
 * Every book's game-line quotes → the offers a sportsbook screen shows: one
 * offer per line (period × kind × team × number) with each side's best price,
 * every book's price, and the model's read — model alone, the books' no-vig
 * consensus, the blend, the fair price and the EV of the best price, pushes
 * included. Pure, so the page and tests share it.
 */
import { isBettableBook } from "@/lib/odds/bestPrice";
import { americanToImpliedProbability, decimalToAmerican } from "@/lib/odds/americanOdds";
import { fairPrice } from "@/lib/odds/marketValue";
import { blendWithMarket, DEFAULT_MODEL_WEIGHT } from "@/lib/propModel/market";
import type { GameModelLeague } from "./leagues";
import type { ExpectedScore } from "./ratings";
import { evWithPush, lineOutcome, noPushProb, type LineOutcome, type MarketKind, type ModelSpreads, type Period, type PeriodSpec } from "./markets";

export interface LineQuote {
  period: Period;
  kind: MarketKind;
  side: string;
  team: string;
  /** The side's own number (spread: that team's; total: the total; 0 for moneylines). */
  point: number;
  bookKey: string;
  bookName: string;
  priceAmerican: number;
}

export interface BookPrice {
  bookKey: string;
  bookName: string;
  priceAmerican: number;
  bettable: boolean;
}

export interface OfferSide {
  side: string;
  point: number;
  best: BookPrice | null;
  books: BookPrice[];
  /** The model's chance this side wins, pushes refunded. */
  modelProb: number | null;
  /** The books' no-vig chance. */
  marketProb: number | null;
  /** The blend we price with. */
  prob: number | null;
  /** Chance of a push at this number (the model's). */
  push: number;
  fairAmerican: number | null;
  /** EV of the best price at the blended chance. */
  ev: number | null;
}

export interface Offer {
  id: string;
  period: Period;
  kind: MarketKind;
  team: string;
  /** Spread: the home team's number; total / team total: the number; moneyline: null. */
  line: number | null;
  sides: OfferSide[];
  /** Bettable books pricing every side. */
  books: number;
}

const SIDE_ORDER: Record<string, number> = { away: 0, over: 0, yes: 0, home: 1, under: 1, no: 1, draw: 2 };

function lineOf(q: LineQuote): number | null {
  if (q.kind === "ml") return null;
  if (q.kind === "spread") return q.side === "home" ? q.point : -q.point;
  return q.point;
}

/** Proportional de-vig of a 3-way market, averaged across books pricing all three. */
function threeWayFair(sides: OfferSide[]): Map<string, number> | null {
  const byBook = new Map<string, Map<string, number>>();
  for (const s of sides) for (const b of s.books) {
    const m = byBook.get(b.bookKey) ?? new Map<string, number>();
    m.set(s.side, americanToImpliedProbability(b.priceAmerican));
    byBook.set(b.bookKey, m);
  }
  const full = [...byBook.values()].filter((m) => m.size === sides.length);
  if (full.length < 3) return null;
  const out = new Map<string, number>();
  for (const m of full) {
    const z = [...m.values()].reduce((a, b) => a + b, 0);
    for (const [side, p] of m) out.set(side, (out.get(side) ?? 0) + p / z / full.length);
  }
  return out;
}

/** What prices a line: any model that gives win/push chances, and how much it counts against the market. */
export interface OfferModel {
  outcome(line: { period: Period; kind: MarketKind; side: string; team: string; point: number; threeWay: boolean }): LineOutcome | null;
  weight(kind: MarketKind): number;
  /** Optional: scale the weight by the market's own chance (fade the model on long shots). */
  tailScale?(marketProb: number): number;
}

/** The NBA/NFL game model as an OfferModel. */
export interface LeagueGameModel {
  league: GameModelLeague;
  expected: ExpectedScore;
  spreads: ModelSpreads;
  weights: Partial<Record<"ml" | "spread" | "total", number>>;
  /** Fitted period shares and spreads; the priors when omitted. */
  specs?: Record<Exclude<Period, "game">, PeriodSpec>;
}

function fromLeagueModel(m: LeagueGameModel): OfferModel {
  return {
    outcome: (line) => lineOutcome(m.league, m.expected, m.spreads, line, m.specs),
    weight: (kind) => m.weights[kind === "teamTotal" ? "total" : (kind as "ml" | "spread" | "total")] ?? DEFAULT_MODEL_WEIGHT,
  };
}

export function buildOffers(quotes: LineQuote[], modelIn: LeagueGameModel | OfferModel | null): Offer[] {
  const model: OfferModel | null = modelIn === null ? null : "outcome" in modelIn ? modelIn : fromLeagueModel(modelIn);
  const groups = new Map<string, LineQuote[]>();
  for (const q of quotes) {
    const key = `${q.period}|${q.kind}|${q.team}|${lineOf(q) ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const offers: Offer[] = [];
  for (const [id, qs] of groups) {
    const first = qs[0];
    const bySide = new Map<string, Map<string, BookPrice>>();
    for (const q of qs) {
      const books = bySide.get(q.side) ?? new Map<string, BookPrice>();
      // One price per book per side (the latest quote wins on a duplicate).
      books.set(q.bookKey, { bookKey: q.bookKey, bookName: q.bookName, priceAmerican: q.priceAmerican, bettable: isBettableBook(q.bookKey) });
      bySide.set(q.side, books);
    }
    const twoWay = first.kind !== "ml" || !bySide.has("draw");
    if (bySide.size < 2) continue;
    const sides: OfferSide[] = [...bySide]
      .sort((a, b) => (SIDE_ORDER[a[0]] ?? 3) - (SIDE_ORDER[b[0]] ?? 3))
      .map(([side, books]) => {
        const list = [...books.values()].sort((a, b) => Number(b.bettable) - Number(a.bettable) || dec(b.priceAmerican) - dec(a.priceAmerican));
        const point = qs.find((q) => q.side === side)!.point;
        return { side, point, best: list.find((b) => b.bettable) ?? null, books: list, modelProb: null, marketProb: null, prob: null, push: 0, fairAmerican: null, ev: null };
      });

    // The market: a 2-way de-vig per book (sharp weighted), or a 3-way proportional one.
    if (twoWay && sides.length === 2) {
      const pairs = sides[0].books.flatMap((a) => {
        const b = sides[1].books.find((x) => x.bookKey === a.bookKey);
        return b ? [{ bookKey: a.bookKey, priceA: a.priceAmerican, priceB: b.priceAmerican }] : [];
      });
      const fair = fairPrice(pairs);
      if (fair) {
        sides[0].marketProb = fair.probA;
        sides[1].marketProb = 1 - fair.probA;
      }
    } else {
      const fair = threeWayFair(sides);
      if (fair) for (const s of sides) s.marketProb = fair.get(s.side) ?? null;
    }

    // The model, blended with the market where there is one.
    if (model) {
      const w = model.weight(first.kind);
      const outcomes = sides.map((s) => model.outcome({ period: first.period, kind: first.kind, side: s.side, team: first.team, point: s.point, threeWay: !twoWay }));
      if (outcomes.every((o) => o !== null)) {
        sides.forEach((s, i) => {
          s.push = outcomes[i]!.push;
          s.modelProb = twoWay ? noPushProb(outcomes[i]!) : outcomes[i]!.win;
        });
        const blended = sides.map((s) => (s.marketProb !== null ? blendWithMarket(s.modelProb!, s.marketProb, w * (model.tailScale?.(s.marketProb) ?? 1)) : s.modelProb!));
        const z = twoWay ? blended[0] + blended[1] : blended.reduce((a, b) => a + b, 0);
        sides.forEach((s, i) => {
          s.prob = blended[i] / z;
          s.fairAmerican = Math.round(decimalToAmerican(1 / s.prob));
          if (s.best) s.ev = evWithPush({ win: s.prob * (1 - s.push), push: s.push }, s.best.priceAmerican);
        });
      }
    }

    const bettableBooks = new Set(sides[0].books.filter((b) => b.bettable && sides.every((s) => s.books.some((x) => x.bookKey === b.bookKey))).map((b) => b.bookKey));
    offers.push({ id, period: first.period, kind: first.kind, team: first.team, line: lineOf(first), sides, books: bettableBooks.size });
  }
  return offers;
}

function dec(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/** The main line among offers of one period/kind/team: the most books, then the most even prices. */
export function mainOffer(offers: Offer[]): Offer | null {
  if (offers.length === 0) return null;
  // How far the two sides' prices sit from a coin flip: the main line is the most balanced.
  const evenness = (o: Offer) => {
    const a = o.sides[0].best;
    const b = o.sides[1]?.best;
    return a && b ? Math.abs(1 / dec(a.priceAmerican) - 1 / dec(b.priceAmerican)) : 1;
  };
  return [...offers].sort((a, b) => b.books - a.books || evenness(a) - evenness(b))[0];
}
