/**
 * Every background job and how fresh it should be, for the one cron that runs
 * them all (/api/cron/tick). Pure.
 *
 * Why one cron: Neon bills the hours the database is awake, and a wake-up costs
 * ~5 minutes however little runs in it (the site went down on 2026-10-14 from
 * ~140 wake-ups a day). On Vercel's Hobby plan each cron fires anywhere inside
 * its hour, so separate entries can't share a wake-up however their minutes are
 * set. The tick wakes the database once and fans out to every job that's due,
 * each in its own function call, so a window costs one wake-up whatever runs.
 *
 * A job is due by its own cadence (minutes since it last ran) or at fixed UTC
 * hours. Jobs that spend odds credits keep their own budget checks besides.
 */

export interface Job {
  /** /api/cron/<path> */
  path: string;
  /** Run when at least this many minutes have passed since the last run… */
  every?: number;
  /** …or at these UTC hours (once each). */
  hours?: number[];
  /** Phase 2 runs after phase 1 finishes (the Discord card after the odds, the recap after the results). */
  phase?: 1 | 2;
}

/** UTC hours the tick runs: hourly 12:00–04:00 (8am–midnight ET and after late games), every 2 hours overnight. */
export const TICK_HOURS = [6, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4];
/** Past this share of the compute budget, the tick runs only on even hours. */
export const THIN_RATIO = 0.6;

export const JOBS: Job[] = [
  // Free, every tick: boards, fixtures and box scores.
  { path: "espn-odds", every: 55 },
  { path: "poll-all-sports", every: 55 },
  { path: "tennis-fixtures", every: 55 },
  { path: "soccer-player-stats", every: 115 },
  { path: "sync-results-nba", every: 175 },
  { path: "sync-results-nfl", every: 175 },
  { path: "ufc-history", every: 175 },
  { path: "nfl-advanced", every: 355 },
  { path: "sync-results", every: 355 },
  // Odds feeds that spend credits: the hours they always ran.
  { path: "poll-odds-nba", hours: [0, 14, 18, 21, 23] },
  { path: "poll-odds-nfl", hours: [10, 21] },
  { path: "poll-odds", hours: [16, 22] },
  // History and catalog, a few times a day.
  { path: "crawl-history", hours: [2, 8, 12, 16] },
  { path: "backfill-all-sports", hours: [6, 18] },
  { path: "sync-schedule", hours: [10, 18] },
  { path: "tennis-history", hours: [8] },
  { path: "backfill-f1", hours: [8] },
  { path: "backfill-ufc", hours: [10] },
  // After the window's primaries.
  { path: "post-discord", hours: [13, 14, 18, 20, 21, 23], phase: 2 },
  { path: "post-results", hours: [0, 6, 13], phase: 2 },
  { path: "cleanup", hours: [10], phase: 2 },
  // MLB game outcomes, graded from the scores sync-results just wrote (same cadence, after it).
  { path: "grade-outcomes", every: 355, phase: 2 },
];

/** Whether the tick should run at all this hour (thinned to even hours when the budget runs low). */
export function tickRuns(now: Date, budgetRatio: number | null): boolean {
  const h = now.getUTCHours();
  if (!TICK_HOURS.includes(h)) return false;
  return budgetRatio === null || budgetRatio < THIN_RATIO || h % 2 === 0;
}

/** The jobs due now, given when each last ran (ms since epoch, or undefined). */
export function dueJobs(now: Date, lastRun: (path: string) => number | undefined, jobs: Job[] = JOBS): Job[] {
  const t = now.getTime();
  const h = now.getUTCHours();
  return jobs.filter((j) => {
    const last = lastRun(j.path);
    if (j.hours) return j.hours.includes(h) && (last === undefined || t - last > 50 * 60_000);
    return last === undefined || t - last >= (j.every ?? 60) * 60_000;
  });
}
