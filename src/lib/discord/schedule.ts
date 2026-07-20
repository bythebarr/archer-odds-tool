/**
 * When the daily posts fire.
 *
 * The room is all-sports, so a fixed clock is wrong: 10:30am ET is a baseball
 * assumption, and it's the reason the old cadence felt MLB-shaped. Instead
 * (owner's 2026-07-20 call):
 *
 *   • the card + slate post **LEAD_HOURS before the day's first event**,
 *     whatever sport that happens to be — a 1pm tennis match pulls the card to
 *     10am, a 10pm UFC main card pushes it to 7pm.
 *   • the results recap posts **as soon as the day's last tracked play settles**,
 *     not on a morning timer.
 *
 * Vercel crons only fire on a fixed schedule, so both are driven by a frequent
 * tick that asks "is it time yet?" — these predicates are that question, kept
 * pure and dependency-free so the timing logic is testable without a clock, a
 * database, or a live board.
 */
import type { Play } from "@/lib/engine";

/** How far ahead of the first event the card drops. */
export const LEAD_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

/** Earliest start across every play on the board, or null when nothing is scheduled. */
export function firstStart(plays: Play[]): Date | null {
  let earliest: Date | null = null;
  for (const p of plays) {
    if (!earliest || p.startUtc < earliest) earliest = p.startUtc;
  }
  return earliest;
}

export type CardTiming =
  | { post: true }
  | { post: false; reason: "no-plays" | "already-posted" | "too-early" };

/**
 * Should the card go out on this tick?
 *
 * Deliberately has NO late cutoff: if a tick is missed (deploy, outage, cron
 * hiccup) the next one still posts, late, rather than skipping the day
 * silently. A late card is recoverable; a missing one looks like a dead room.
 */
export function cardTiming(
  now: Date,
  plays: Play[],
  alreadyPostedForDate: boolean,
  leadHours: number = LEAD_HOURS
): CardTiming {
  if (alreadyPostedForDate) return { post: false, reason: "already-posted" };
  const start = firstStart(plays);
  if (!start) return { post: false, reason: "no-plays" };
  const dropAt = new Date(start.getTime() - leadHours * HOUR_MS);
  return now >= dropAt ? { post: true } : { post: false, reason: "too-early" };
}

/** The moment the card is due, for logging/preview ("drops at 10:04a ET"). */
export function cardDropTime(plays: Play[], leadHours: number = LEAD_HOURS): Date | null {
  const start = firstStart(plays);
  return start ? new Date(start.getTime() - leadHours * HOUR_MS) : null;
}

/** The hour (0–23) it currently is in ET — the room's operating timezone. */
export function etHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York",
  }).format(now);
  // Intl can render midnight as "24" in some ICU versions; normalize to 0.
  return Number(h) % 24;
}

export type TipTiming = { post: true } | { post: false; reason: "already-posted" | "too-early" };

/**
 * Should today's tip go out?
 *
 * Unlike the card, a tip is tied to no event, so a clock is the RIGHT rule here
 * rather than a lazy one — it should land in the morning whether or not there's
 * a slate, since the days with no plays are exactly the days a free member needs
 * a reason to open the room.
 */
export function tipTiming(
  now: Date,
  alreadyPostedForDate: boolean,
  afterHourEt = 9
): TipTiming {
  if (alreadyPostedForDate) return { post: false, reason: "already-posted" };
  return etHour(now) >= afterHourEt ? { post: true } : { post: false, reason: "too-early" };
}

/** A recorded play, reduced to what the recap gate needs. */
export interface SettleState {
  gradedAt: Date | null;
}

export type ResultsTiming =
  | { post: true }
  | { post: false; reason: "no-plays" | "already-posted" | "still-pending"; pending?: number };

/**
 * Should the results recap go out for this date?
 *
 * Only once EVERY tracked play for the date has settled — a recap posted while
 * a night game is still running would show a partial record, and a partial
 * record on the trust channel is worse than a late one. Plays that grade as
 * void still count as settled (they carry gradedAt), so a voided sport can't
 * hold the recap hostage forever.
 */
export function resultsTiming(
  plays: SettleState[],
  alreadyPostedForDate: boolean
): ResultsTiming {
  if (alreadyPostedForDate) return { post: false, reason: "already-posted" };
  if (!plays.length) return { post: false, reason: "no-plays" };
  const pending = plays.filter((p) => p.gradedAt === null).length;
  return pending === 0 ? { post: true } : { post: false, reason: "still-pending", pending };
}
