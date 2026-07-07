import { DateTime } from "luxon";

const MLB_TIMEZONE = "America/New_York";

/** UTC [gte, lt) bounds for a given ET calendar date (YYYY-MM-DD), DST-aware. Throws on an invalid date. */
export function etDayBoundsUtc(dateEt: string): { gte: Date; lt: Date } {
  const start = DateTime.fromISO(dateEt, { zone: MLB_TIMEZONE }).startOf("day");
  if (!start.isValid) {
    throw new Error(`Invalid date "${dateEt}": ${start.invalidExplanation}`);
  }
  const end = start.plus({ days: 1 });
  return { gte: start.toJSDate(), lt: end.toJSDate() };
}

/** Today's date in the MLB schedule's home timezone (ET), as YYYY-MM-DD. */
export function todayEt(): string {
  return DateTime.now().setZone(MLB_TIMEZONE).toISODate()!;
}

export function isValidEtDate(dateEt: string): boolean {
  return DateTime.fromISO(dateEt, { zone: MLB_TIMEZONE }).isValid;
}

export function shiftEtDate(dateEt: string, days: number): string {
  return DateTime.fromISO(dateEt, { zone: MLB_TIMEZONE }).plus({ days }).toISODate()!;
}

/**
 * Human-friendly label for an ET calendar date (YYYY-MM-DD), e.g. "Tue, Jul 8".
 * Used for the day-nav center label so the two most-visited pages don't show a
 * raw ISO string. Falls back to the raw input if it can't be parsed.
 */
export function formatEtDateLabel(dateEt: string): string {
  const dt = DateTime.fromISO(dateEt, { zone: MLB_TIMEZONE });
  return dt.isValid ? dt.toFormat("ccc, LLL d") : dateEt;
}
