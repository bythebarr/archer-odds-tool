/**
 * CONFIDENCE — how far to trust ARCHR's read of one bet. Not a probability
 * and not the edge: two bets can both read 60% with the same edge, and one
 * of them rests on a proven model, a long record that agrees and a settled
 * role, the other on six games, a questionable tag and a number that's way off
 * the books'. Confidence tells them apart.
 *
 *   ARCHR chance  how often it should hit (the one probability)
 *   ARCHR edge    that chance against the best price
 *   Confidence    how much the first two can be trusted on this bet (A–D)
 *
 * The score starts at BASE and each factor below moves it by a stated number
 * of points, so the grade is always explainable: every factor carries the
 * plain-language reason it moved (or didn't), and the player sheet lists them.
 * The cautious read (the record-backed check, lib/propModel/cautiousRead) is
 * one factor here, not a column of its own.
 *
 * The thresholds are a prior written down in one place, not a fit:
 * scripts/backtest-confidence.ts grades them on real closing prices. Pure.
 */
import { cautiousEdge } from "./canonical";
import type { Rate } from "@/lib/builder/types";

export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface ConfidenceInput {
  /** ARCHR chance on this side (null: no read, so no grade). */
  archr: number | null;
  /** The books' no-vig chance on this side; null without a two-sided market. */
  marketChance: number | null;
  /** Best price on this side, American; null when only a number is posted. */
  priceAmerican: number | null;
  /** His recent record at this line on this side (L10, or the season when L10 is thin). */
  rate: Rate;
  /** Games of his history behind the projection. */
  sampleGames: number;
  /** The blend report card's verdict for this stat ("trusted" is proven); undefined for sports the blend doesn't price. */
  blendVerdict?: string | null;
  /** Injury tag: "probable", "questionable", "doubtful", "day-to-day"…; null when clear. */
  injury?: string | null;
  /** NBA: projected minutes tonight, and his recent average (null when unknown). */
  minutes?: { projected: number; recent: number | null } | null;
  /** An alt rung rather than the book's main line. */
  alt?: boolean;
}

export interface ConfidenceFactor {
  key: "track" | "sample" | "record" | "market" | "minutes" | "injury" | "line" | "price";
  /** Points this factor moved the score (0 = context only). */
  effect: number;
  /** One plain sentence: what was found and why it matters. */
  text: string;
}

export interface Confidence {
  /** 0–100. */
  score: number;
  grade: ConfidenceGrade;
  factors: ConfidenceFactor[];
}

/**
 * Whether scripts/backtest-confidence has shown higher grades are where ARCHR's
 * read holds up. Until it has, every surface marks the grade unproven. The
 * 2026-11-12 run (700 NBA sides at closing prices) did NOT show it: grade B
 * was no more accurate than C and D, and its edge bets didn't pay more. Flip
 * only on a VALIDATED verdict.
 */
export const CONFIDENCE_VALIDATED = false;

/** Where every bet starts: neither trusted nor doubted. */
export const BASE = 55;
export const GRADE_CUTS: [ConfidenceGrade, number][] = [
  ["A", 75],
  ["B", 60],
  ["C", 45],
  ["D", -Infinity],
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} pts`;
const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

export const gradeOf = (score: number): ConfidenceGrade => GRADE_CUTS.find(([, cut]) => score >= cut)![0];

/** The grade and every factor behind it; null when ARCHR has no read on the bet. */
export function confidenceOf(c: ConfidenceInput): Confidence | null {
  if (c.archr === null) return null;
  const f: ConfidenceFactor[] = [];
  const add = (key: ConfidenceFactor["key"], effect: number, text: string) => f.push({ key, effect, text });
  const [hits, games] = c.rate;
  const priceChance = c.priceAmerican !== null ? implied(c.priceAmerican) : null;
  const books = c.marketChance ?? priceChance;

  // 1. Track record: has this stat's blend earned a passing report card on real closing prices?
  if (c.blendVerdict === undefined) add("track", 0, "This sport's props come from their own projection model; there's no blend report card to lean on yet.");
  else if (c.blendVerdict === "trusted") add("track", 10, "ARCHR's numbers for this stat have a passing report card on real closing prices.");
  else add("track", -5, "ARCHR's numbers for this stat haven't earned a passing report card yet (Unproven).");

  // 2. How much history the projection rests on.
  if (c.sampleGames < 5) add("sample", -20, `Only ${c.sampleGames} games of history: the projection leans on league averages.`);
  else if (c.sampleGames < 10) add("sample", -10, `${c.sampleGames} games of history: a thin base for a projection.`);
  else if (c.sampleGames >= 30) add("sample", 5, `${c.sampleGames} games of history behind the projection.`);
  else add("sample", 0, `${c.sampleGames} games of history behind the projection.`);

  // 3. The record check (the cautious read): does his record at this line back the price, or only the model?
  if (priceChance !== null && games >= 5) {
    const recordRate = hits / games;
    const cautious = cautiousEdge(c.archr, c.rate, c.priceAmerican);
    const modelLikes = c.archr > priceChance;
    if (cautious !== null && cautious >= 0 && modelLikes)
      add("record", 10, `Record backs it: ${hits}/${games} here, and even read cautiously the price (${pct(priceChance)}) undervalues it.`);
    else if (modelLikes && recordRate < priceChance - 0.1)
      add("record", -15, `Record doesn't back it: ${hits}/${games} here against the ${pct(priceChance)} the price implies. Only the model likes it.`);
    else if (!modelLikes && recordRate >= priceChance + 0.1)
      add("record", 0, `Hot record (${hits}/${games}), but the books have priced it in: at ${pct(priceChance)} implied, ARCHR (${pct(c.archr)}) sees no value left.`);
    else add("record", 0, `Record ${hits}/${games} here, close to what the price implies (${pct(priceChance)}).`);
  } else if (games < 5) add("record", -5, `Only ${games} recent games at this line: no record to check the read against.`);

  // 4. Disagreement with the books: a big gap is more often missing information than value.
  if (books !== null) {
    const gap = c.archr - books;
    const vs = c.marketChance !== null ? "the books' no-vig chance" : "the chance the price implies";
    if (gap > 0.15) add("market", -15, `ARCHR is ${pts(gap)} above ${vs}: gaps this big are usually news the model hasn't seen (injury, role, rest).`);
    else if (gap > 0.08) add("market", -5, `ARCHR is ${pts(gap)} above ${vs}: a real disagreement, worth a second look.`);
    else if (gap < -0.15) add("market", 0, `ARCHR is ${pts(gap)} below ${vs}: the books like this side far more than ARCHR does.`);
    else add("market", 0, `ARCHR is within ${pts(Math.max(Math.abs(gap), 0.01))} of ${vs}.`);
  }

  // 5. Minutes (NBA): a role in flux or a small role widens everything.
  if (c.minutes) {
    const { projected, recent } = c.minutes;
    if (recent !== null && recent > 0 && Math.abs(projected / recent - 1) > 0.2)
      add("minutes", -10, `Minutes in flux: ${projected.toFixed(1)} projected against ${recent.toFixed(1)} lately.`);
    else if (projected < 18) add("minutes", -5, `Small role (${projected.toFixed(1)} projected minutes): a few minutes either way swing the line.`);
    else add("minutes", 0, `Settled role: ${projected.toFixed(1)} projected minutes${recent !== null ? `, ${recent.toFixed(1)} lately` : ""}.`);
  }

  // 6. Injury tag.
  const tag = c.injury?.toLowerCase() ?? null;
  if (tag === "questionable" || tag === "doubtful") add("injury", -15, `Listed ${tag}: he may not play, or play limited.`);
  else if (tag) add("injury", -5, `Listed ${tag}.`);

  // 7. Alt rungs are the model's weak spot (the tail of the distribution).
  if (c.alt) add("line", -5, "An alt line, not the book's main number: the tails of a projection are its least reliable part.");

  // 8. A number with no price yet can't be checked against a book.
  if (c.priceAmerican === null) add("price", -10, "No book has priced this yet: there's no price to measure the edge against.");

  const score = Math.max(0, Math.min(100, BASE + f.reduce((s, x) => s + x.effect, 0)));
  return { score, grade: gradeOf(score), factors: f };
}

/** One-line summary of the grade, for a tooltip. */
export function confidenceSummary(c: Confidence): string {
  const moved = c.factors.filter((x) => x.effect !== 0).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return `Confidence ${c.grade} (${c.score}/100)${moved.length ? ": " + moved.slice(0, 3).map((x) => x.text.split(":")[0]).join("; ") : ""}`;
}

/** The grade as a board row carries it: the full factors live on the player sheet. */
export interface CompactConfidence {
  grade: ConfidenceGrade;
  score: number;
  /** The factors that moved it most, in a line: the row's tooltip. */
  why: string;
}

export function compactConfidence(c: Confidence | null): CompactConfidence | undefined {
  if (!c) return undefined;
  const moved = c.factors.filter((x) => x.effect !== 0).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const why = moved.length ? moved.slice(0, 3).map((x) => `${x.effect > 0 ? "+" : "−"}${Math.abs(x.effect)} ${x.text.split(":")[0]}`).join(" · ") : "Nothing moved it either way";
  return { grade: c.grade, score: c.score, why };
}
