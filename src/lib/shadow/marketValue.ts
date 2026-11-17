/**
 * The experimental market-value engine (docs/alpha-sprint.md): for every NBA
 * main-line prop, each side's offered price against ARCHR's raw chance, the
 * v2 shadow's corrected chance and the books' no-vig chance, with the
 * warnings that say how far to trust any of it. Pure.
 *
 * Expected value is always at the actual offered price. The market read is
 * every book hanging both sides at the line, de-vigged; where several books
 * do, the evaluated book's own pair is left out of it (a price can't be
 * judged against a consensus it is part of). With one book only, the read is
 * that book's own pair and is labeled single-book.
 *
 * Status is never earned by a high number: research (every row), a
 * forward-testing candidate (passes the frozen rule below; recorded before
 * tip and judged on games it hasn't seen), or an independently validated
 * positive-EV candidate — only if its rule is in VALIDATED_RULES, which stays
 * empty until forward evidence says otherwise (docs/alpha-sprint.md,
 * promotion checklist).
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";

export interface ValueQuote {
  bookKey: string;
  bookName: string;
  side: "over" | "under";
  priceAmerican: number;
  /** When the book's quote was last read; null when unknown. */
  polledAt: Date | null;
}

export interface ValueInput {
  id: string;
  playerId: string;
  player: string;
  team: string;
  opponent: string;
  gameId: string;
  startsAt: string;
  stat: string;
  statLabel: string;
  point: number;
  /** Every quote at this line. */
  quotes: ValueQuote[];
  /** Chance of the Over: production's projection alone (raw), the v1 shadow s2 and the v2 shadow. */
  rawOver: number | null;
  s2Over: number | null;
  v2Over: number | null;
  /** v2's distance from the line, (mean − line) ÷ SD, in Over terms. */
  v2Z: number | null;
  /** v2's expected minutes and the predicted size of the miss. */
  minutes: number | null;
  minutesScale: number | null;
  /** Injury tag tonight (questionable, probable…), null with none. */
  injury: string | null;
  /** Tonight's lineup: confirmed starter, confirmed out of the five, or not known yet. */
  lineup: "confirmed-starter" | "confirmed-bench" | "unconfirmed";
  /** Games played (both seasons). */
  games: number;
}

export type Warning = "unstable-minutes" | "injury" | "lineup-unconfirmed" | "extreme-distance" | "plus-money-calibration" | "stale-price" | "aging-price" | "sparse-history" | "single-book" | "no-market";
export type EvidenceStatus = "research" | "forward-testing" | "validated";

export interface SideValue {
  side: "over" | "under";
  price: number;
  book: string;
  bookKey: string;
  breakEven: number;
  rawProb: number | null;
  s2Prob: number | null;
  v2Prob: number | null;
  /** The books' no-vig chance of this side, without the evaluated book where others hang the line; null with no two-sided market. */
  noVig: number | null;
  noVigBooks: number;
  singleBook: boolean;
  /**
   * At the offered price: the conservative experimental expected value — the
   * lower of s2's and v2's (v2's corrections failed the clean holdout, so
   * neither model alone sets it) — each model's own, and the market's (what the
   * other books' consensus says this price is worth).
   */
  ev: number | null;
  evS2: number | null;
  evV2: number | null;
  marketEv: number | null;
  /** v2's distance toward this side. */
  distance: number | null;
  minutesReliability: "stable" | "moderate" | "unstable" | "unknown";
  priceAgeMinutes: number | null;
  warnings: Warning[];
  /** Passes the data-quality gate EV ranking needs. */
  quality: boolean;
  status: EvidenceStatus;
  /** Why it is (or isn't) a forward-testing candidate. */
  candidateReason: string;
}

export interface ValueRow extends Omit<ValueInput, "quotes"> {
  over: SideValue | null;
  under: SideValue | null;
}

/** The frozen candidate rule (pre-registered 2026-11-17; changing it is a new id and a new forward clock). */
export const CANDIDATE_RULE = {
  id: "plus-money-v1",
  minPrice: 100,
  maxPrice: 175,
  /** The conservative expected value (the lower of s2's and v2's) at the offered price. */
  minEv: 0.03,
  /** No player twice, and at most this many per slate (fewer, or none, is fine). */
  perSlate: 6,
} as const;

/** Rules forward evidence has validated (docs/alpha-sprint.md promotion checklist). Empty: nothing is validated. */
export const VALIDATED_RULES: readonly string[] = [];

/** A price older than this is aging; older than STALE, stale (props are polled about hourly). */
export const AGING_MINUTES = 90;
export const STALE_MINUTES = 150;
/** Beyond this distance from the line the model's far calls have run overconfident (lab:nba-shadow, lab:nba-v2). */
export const EXTREME_DISTANCE = 1;
/** Minutes miss-scale tiers. */
export const MINUTES_STABLE = 4.5;
export const MINUTES_UNSTABLE = 6;
export const MIN_GAMES = 15;

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

/** Each book's no-vig chance of the Over at a line, from books hanging both sides. */
export function bookPairs(quotes: ValueQuote[]): Map<string, number> {
  const books = new Map<string, { over?: number; under?: number }>();
  for (const q of quotes) (books.get(q.bookKey) ?? books.set(q.bookKey, {}).get(q.bookKey)!)[q.side] = q.priceAmerican;
  const out = new Map<string, number>();
  for (const [k, b] of books) if (b.over !== undefined && b.under !== undefined) out.set(k, implied(b.over) / (implied(b.over) + implied(b.under)));
  return out;
}

/** The consensus no-vig Over chance excluding one book (or every book when it is the only one). */
export function consensusExcluding(pairs: Map<string, number>, exclude: string): { over: number | null; books: number; singleBook: boolean } {
  const others = [...pairs].filter(([k]) => k !== exclude).map(([, v]) => v);
  if (others.length) return { over: others.reduce((a, b) => a + b, 0) / others.length, books: others.length, singleBook: false };
  const all = [...pairs.values()];
  return all.length ? { over: all[0], books: 1, singleBook: true } : { over: null, books: 0, singleBook: false };
}

export function minutesReliability(scale: number | null): SideValue["minutesReliability"] {
  if (scale === null) return "unknown";
  return scale < MINUTES_STABLE ? "stable" : scale < MINUTES_UNSTABLE ? "moderate" : "unstable";
}

function sideValue(row: ValueInput, side: "over" | "under", pairs: Map<string, number>, now: Date): SideValue | null {
  const offered = row.quotes.filter((q) => q.side === side);
  if (!offered.length) return null;
  const best = offered.reduce((a, b) => (b.priceAmerican > a.priceAmerican ? b : a));
  const toSide = (over: number | null) => (over === null ? null : side === "over" ? over : 1 - over);
  const market = consensusExcluding(pairs, best.bookKey);
  const v2Prob = toSide(row.v2Over);
  const s2Prob = toSide(row.s2Over);
  const dec = americanToDecimal(best.priceAmerican);
  const noVig = toSide(market.over);
  const distance = row.v2Z === null ? null : side === "over" ? row.v2Z : -row.v2Z;
  const age = best.polledAt ? (now.getTime() - best.polledAt.getTime()) / 60_000 : null;
  const reliability = minutesReliability(row.minutesScale);
  const warnings: Warning[] = [];
  if (reliability === "unstable") warnings.push("unstable-minutes");
  if (row.injury) warnings.push("injury");
  if (row.lineup === "unconfirmed") warnings.push("lineup-unconfirmed");
  if (distance !== null && Math.abs(distance) > EXTREME_DISTANCE) warnings.push("extreme-distance");
  if (best.priceAmerican >= 100) warnings.push("plus-money-calibration");
  if (age === null || age > STALE_MINUTES) warnings.push("stale-price");
  else if (age > AGING_MINUTES) warnings.push("aging-price");
  if (row.games < MIN_GAMES) warnings.push("sparse-history");
  if (market.over === null) warnings.push("no-market");
  else if (market.singleBook) warnings.push("single-book");
  // The data-quality gate: EV is only ranked where nothing on this list holds.
  // (Plus-money calibration, single-book and an unconfirmed lineup are shown, not gating: they are the normal case.)
  const gating: Warning[] = ["unstable-minutes", "injury", "extreme-distance", "stale-price", "sparse-history", "no-market"];
  const quality = v2Prob !== null && s2Prob !== null && !warnings.some((w) => gating.includes(w));
  const evV2 = v2Prob === null ? null : v2Prob * dec - 1;
  const evS2 = s2Prob === null ? null : s2Prob * dec - 1;
  const ev = evV2 === null || evS2 === null ? null : Math.min(evV2, evS2);
  const inRange = best.priceAmerican >= CANDIDATE_RULE.minPrice && best.priceAmerican <= CANDIDATE_RULE.maxPrice;
  const candidateReason = !inRange
    ? `price outside +${CANDIDATE_RULE.minPrice} to +${CANDIDATE_RULE.maxPrice}`
    : !quality
      ? "fails the data-quality gate"
      : ev === null || ev < CANDIDATE_RULE.minEv
        ? `expected value under +${Math.round(CANDIDATE_RULE.minEv * 100)}% on s2 or v2`
        : "passes the frozen rule";
  return {
    side,
    price: best.priceAmerican,
    book: best.bookName,
    bookKey: best.bookKey,
    breakEven: 1 / dec,
    rawProb: toSide(row.rawOver),
    s2Prob,
    v2Prob,
    noVig,
    noVigBooks: market.books,
    singleBook: market.singleBook,
    ev,
    evS2,
    evV2,
    marketEv: noVig === null ? null : noVig * dec - 1,
    distance,
    minutesReliability: reliability,
    priceAgeMinutes: age === null ? null : Math.round(age),
    warnings,
    quality,
    status: "research",
    candidateReason,
  };
}

/** Each prop's two sides, valued. */
export function valueRows(inputs: ValueInput[], now: Date): ValueRow[] {
  return inputs.map((row) => {
    const pairs = bookPairs(row.quotes);
    const { quotes: _quotes, ...rest } = row;
    void _quotes;
    return { ...rest, over: sideValue(row, "over", pairs, now), under: sideValue(row, "under", pairs, now) };
  });
}

/**
 * Apply the frozen candidate rule to a slate: sides passing it, best v2 EV
 * first, one per player, at most CANDIDATE_RULE.perSlate. Marks them
 * forward-testing (or validated, only if the rule is in VALIDATED_RULES).
 * `limit`: the slots left on this slate (capture runs game by game through
 * the night, so earlier batches' picks count against the six). Returns the
 * candidates' ids ("rowId|side"), in rank order.
 */
export function markCandidates(rows: ValueRow[], limit: number = CANDIDATE_RULE.perSlate): string[] {
  const passing = rows
    .flatMap((r) => [r.over, r.under].filter((s): s is SideValue => s !== null && s.candidateReason === "passes the frozen rule").map((s) => ({ r, s })))
    .sort((a, b) => (b.s.ev ?? 0) - (a.s.ev ?? 0));
  const players = new Set<string>();
  const picked: string[] = [];
  for (const { r, s } of passing) {
    if (players.has(r.playerId) || picked.length >= Math.min(limit, CANDIDATE_RULE.perSlate)) continue;
    players.add(r.playerId);
    s.status = VALIDATED_RULES.includes(CANDIDATE_RULE.id) ? "validated" : "forward-testing";
    picked.push(`${r.id}|${s.side}`);
  }
  return picked;
}

/**
 * The screen's order: EV only among sides that pass the data-quality gate;
 * the rest by research priority (fewest warnings, then how far v2 sits from
 * the market), which is not a profitability ranking.
 */
export function screenOrder(sides: { s: SideValue }[]): { s: SideValue; rankedBy: "ev" | "research" }[] {
  const ranked = sides.filter((x) => x.s.quality).sort((a, b) => (b.s.ev ?? -1) - (a.s.ev ?? -1));
  const research = sides
    .filter((x) => !x.s.quality)
    .sort((a, b) => a.s.warnings.length - b.s.warnings.length || Math.abs((b.s.v2Prob ?? 0) - (b.s.noVig ?? 0)) - Math.abs((a.s.v2Prob ?? 0) - (a.s.noVig ?? 0)));
  return [...ranked.map((x) => ({ ...x, rankedBy: "ev" as const })), ...research.map((x) => ({ ...x, rankedBy: "research" as const }))];
}
