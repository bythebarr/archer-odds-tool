/**
 * How often each league's odds are refreshed: the closer its next game, the
 * faster — lines move most in the last hours, and that's when a stale price
 * costs the most. A budget governor stretches every interval when the month's
 * spend runs ahead of plan, so the feed never runs dry mid-month.
 */
export interface CadenceInput {
  nextEventAt: Date | null;
  lastPolledAt: Date | null;
  outright: boolean;
}

/** Minutes between polls by time to the league's next start. */
export function baseIntervalMinutes(minutesToNext: number | null, outright: boolean): number | null {
  if (outright) return 24 * 60;
  if (minutesToNext === null) return null; // nothing scheduled: nothing to poll
  if (minutesToNext <= 120) return 10;
  if (minutesToNext <= 24 * 60) return 30;
  if (minutesToNext <= 72 * 60) return 3 * 60;
  return 12 * 60;
}

export function isDue(l: CadenceInput, now: Date, stretch = 1): boolean {
  const toNext = l.nextEventAt ? (l.nextEventAt.getTime() - now.getTime()) / 60_000 : null;
  const base = baseIntervalMinutes(toNext !== null && toNext < -240 ? null : toNext, l.outright);
  if (base === null) return false;
  if (!l.lastPolledAt) return true;
  // A minute of slack, so a 10-minute league isn't skipped by a cron firing at 9:59.
  return (now.getTime() - l.lastPolledAt.getTime()) / 60_000 >= base * stretch - 1;
}

/**
 * The governor: 1 while spend is on plan, growing as it runs ahead. With
 * `budget` units a month, by this point in the month we "should" have spent
 * budget × elapsed share; every 5% of the budget over that adds 1× to every
 * interval, up to 8×.
 */
export function budgetStretch(spentThisMonth: number, budget: number, now: Date): number {
  if (budget <= 0) return 1;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const planned = budget * ((now.getTime() - start) / (end - start));
  const over = spentThisMonth - planned;
  if (over <= 0) return 1;
  return Math.min(8, 1 + over / (budget * 0.05));
}
