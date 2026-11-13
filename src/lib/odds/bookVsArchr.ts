/**
 * Book line vs ARCHR line: one cell, two numbers in one format —
 * "DK −337 · ARCHR −350", "DK +3.5 · ARCHR +5.2", "DK O 224.5 · ARCHR 228.1".
 *
 * ARCHR's number is ARCHR's own read of the same market in the book's format:
 * a fair American price for a moneyline or prop (from ARCHR's chance), the
 * projected spread or total for those markets. When ARCHR has no read it is
 * null and the book line shows alone — never a number made up to fill the
 * slot.
 *
 * Tone: "value" when the book's line is better for the bettor than ARCHR's
 * fair line, "worse" when it's worse, "even" on the same number. Display
 * only: nothing here prices, gates or scores.
 *
 * A price is dated ("price from Nov 1") when its own poll is older than
 * PRICE_STALE_HOURS; a price from a feed that is still updating gets no
 * stamp. Pure.
 */
import { americanToDecimal, decimalToAmerican, formatAmerican, formatSpreadPoint } from "./americanOdds";
import { BOOK_INITIALS } from "./bookAllowlist";

export type ArchrLine =
  | { kind: "price"; american: number }
  | { kind: "spread"; point: number }
  | { kind: "total"; point: number; side: "over" | "under" };

export type LineTone = "value" | "worse" | "even";

/** ARCHR's chance as a fair American price; null without a usable chance. */
export function fairAmericanOf(p: number | null | undefined): number | null {
  if (p == null || !Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return decimalToAmerican(1 / p);
}

/** A projected spread or total rounded to a tenth, the way ARCHR's line reads. */
const tenth = (x: number) => Math.round(x * 10) / 10;

export function formatArchrLine(a: ArchrLine): string {
  if (a.kind === "price") return formatAmerican(a.american);
  if (a.kind === "spread") return formatSpreadPoint(tenth(a.point));
  return `${tenth(a.point)}`;
}

/**
 * Is the book's line better than ARCHR's fair line, for the bettor?
 *   price  — the book pays more than ARCHR's fair price
 *   spread — the book gives more points (or lays fewer) than ARCHR's spread
 *   total  — Over: the book's number is below ARCHR's total; Under: above it
 * Null when there's nothing to compare.
 */
export function lineTone(book: { priceAmerican: number; point: number | null } | null, archr: ArchrLine | null): LineTone | null {
  if (!book || !archr) return null;
  let diff: number;
  if (archr.kind === "price") diff = americanToDecimal(book.priceAmerican) - americanToDecimal(archr.american);
  else if (book.point === null) return null;
  else if (archr.kind === "spread") diff = book.point - tenth(archr.point);
  else diff = archr.side === "over" ? tenth(archr.point) - book.point : book.point - tenth(archr.point);
  if (Math.abs(diff) < 1e-9) return "even";
  return diff > 0 ? "value" : "worse";
}

/** "DK", "FD", "MGM"…; the book's name when it has no short form. */
export function bookShort(bookKey: string, bookName?: string): string {
  return BOOK_INITIALS[bookKey] ?? bookName ?? bookKey;
}

/** Older than this, a price is dated. Covers the longest scheduled gap between paid odds polls (14 h) plus a late tick. */
export const PRICE_STALE_HOURS = 18;

/** "Nov 1" in Eastern time when the price was polled more than PRICE_STALE_HOURS ago; null for a live price. */
export function staleDate(polledAt: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!polledAt) return null;
  const t = new Date(polledAt);
  if (Number.isNaN(t.getTime())) return null;
  if (now.getTime() - t.getTime() <= PRICE_STALE_HOURS * 3_600_000) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(t);
}
