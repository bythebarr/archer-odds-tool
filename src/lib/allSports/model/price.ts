/**
 * Every line on an event, priced: the books' prices grouped into offers
 * (gameModel/offers.ts — the same builder the NBA and NFL boards use), each
 * side read by the league's model where it has one and blended with the
 * books' no-vig consensus.
 *
 * Market first: the model's weight scales with how much history both teams
 * have (none → the market alone, plainly labeled), so a league we just started
 * covering never wears a confident edge it hasn't earned.
 */
import { buildOffers, type LineQuote, type Offer, type OfferModel } from "@/lib/gameModel/offers";
import { decimalToAmerican } from "@/lib/odds/americanOdds";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import type { MarketKind, Period } from "@/lib/gameModel/markets";
import type { SportFamily } from "../sports";
import type { LeagueRatings } from "./ratings";
import { lineOutcomeFor } from "./outcomes";

export interface StoredLine {
  bookKey: string;
  market: string;
  period: string;
  side: string;
  point: number;
  priceAmerican: number;
}

/** Most the model counts against the market, by family, once both teams have full history. */
export const MAX_MODEL_WEIGHT: Record<SportFamily, number> = { goals: 0.3, points: 0.3, winner: 0.25, field: 0 };
/** Games each team needs before the model counts at full weight. */
const FULL_CONFIDENCE_GAMES: Record<SportFamily, number> = { goals: 15, points: 12, winner: 12, field: 1 };
/** Below this, the model sits out and the market prices alone. */
const MIN_GAMES = 3;

/** How much the model counts for this matchup: 0 to MAX_MODEL_WEIGHT. */
export function modelWeight(r: LeagueRatings | null, home: string, away: string): number {
  if (!r) return 0;
  const n = Math.min(r.games(home), r.games(away));
  if (n < MIN_GAMES) return 0;
  return MAX_MODEL_WEIGHT[r.family] * Math.min(1, n / FULL_CONFIDENCE_GAMES[r.family]);
}

const KIND: Record<string, { kind: MarketKind; team: string }> = {
  ml: { kind: "ml", team: "" },
  spread: { kind: "spread", team: "" },
  total: { kind: "total", team: "" },
  team_total_home: { kind: "teamTotal", team: "home" },
  team_total_away: { kind: "teamTotal", team: "away" },
  btts: { kind: "btts", team: "" },
  dnb: { kind: "dnb", team: "" },
};

export function toQuotes(lines: StoredLine[]): LineQuote[] {
  return lines.flatMap((l) => {
    const k = KIND[l.market];
    if (!k) return [];
    return [{ period: l.period as Period, kind: k.kind, team: k.team, side: l.side, point: l.point, bookKey: l.bookKey, bookName: BOOK_NAMES[l.bookKey] ?? l.bookKey, priceAmerican: l.priceAmerican }];
  });
}

export interface PricedOffer extends Offer {
  /** "blend": model and market; "market": the books' no-vig consensus alone. */
  source: "blend" | "market";
}

/**
 * Long shots are where a results-only model is least trustworthy (and where the
 * favorite–longshot bias already lives in the price): below a 20% market chance
 * the model's weight fades linearly, to nothing at 0.
 */
export function tailScale(marketProb: number): number {
  return Math.min(1, Math.min(marketProb, 1 - marketProb) / 0.2);
}

const dec = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);

export function priceEvent(lines: StoredLine[], ratings: LeagueRatings | null, home: string, away: string, sport: string): { offers: PricedOffer[]; weight: number } {
  const weight = modelWeight(ratings, home, away);
  const model: OfferModel | null =
    ratings && weight > 0
      ? { outcome: (line) => lineOutcomeFor(ratings, home, away, line, sport), weight: () => weight, tailScale }
      : null;
  const offers = buildOffers(toQuotes(lines), model, { minBooks: 1 }).map((o): PricedOffer => {
    if (o.sides.every((s) => s.prob !== null)) return { ...o, source: "blend" };
    // Market-only: the no-vig consensus is the read, EV the best price against it.
    for (const s of o.sides) {
      if (s.marketProb === null) continue;
      s.prob = s.marketProb;
      s.fairAmerican = Math.round(decimalToAmerican(1 / s.prob));
      if (s.best) s.ev = s.prob * (dec(s.best.priceAmerican) - 1) - (1 - s.prob);
    }
    return { ...o, source: "market" };
  });
  return { offers, weight };
}

export interface ArchrRead {
  /** Win chances: 3-way where the sport draws (draw > 0), else 2-way with overtime. */
  probs: { home: number; draw: number; away: number };
  /** ARCHR's fair American price on each side. */
  fair: { home: number; draw: number | null; away: number };
  /** ARCHR's own lines: the home side's handicap and the total, to the half-point. */
  spread: number | null;
  total: number | null;
}

const toAmerican = (p: number) => Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p))));

/**
 * ARCHR's own prices on a game, from the model alone — what the board shows
 * before any book posts. Null until both sides have enough history to rate.
 */
export function archrRead(r: LeagueRatings | null, home: string, away: string, sport: string): ArchrRead | null {
  if (!r || Math.min(r.games(home), r.games(away)) < 3) return null;
  const threeWay = r.family === "goals" && sport !== "hockey";
  const win = (side: string) => lineOutcomeFor(r, home, away, { kind: "ml", period: "game", side, team: "", point: 0, threeWay }, sport)?.win ?? null;
  const h = win("home");
  const a = win("away");
  if (h === null || a === null) return null;
  const d = threeWay ? (win("draw") ?? 0) : 0;
  const e = r.expected(home, away);
  // Both lines on the nearest half-point, the way books hang them (no push): the total,
  // and the home side's handicap (negative when it's favored).
  const nearestHalf = (x: number) => Math.round(x - 0.5) + 0.5;
  const total = e ? nearestHalf(e.home + e.away) : null;
  const margin = e ? e.home - e.away : null;
  const spread = margin === null ? null : margin >= 0 ? -nearestHalf(margin) : nearestHalf(-margin);
  return {
    probs: { home: h, draw: d, away: a },
    fair: { home: toAmerican(h), draw: threeWay ? toAmerican(d) : null, away: toAmerican(a) },
    spread: r.family === "winner" ? null : spread,
    total: r.family === "winner" ? null : total,
  };
}
