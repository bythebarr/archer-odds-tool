import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordPollLog, shouldPollNow } from "@/lib/pollingPolicy";
import { ingestSeasonSchedule } from "./ingestSchedule";
import { backfillF1History } from "./backfillF1";

/**
 * Read-side self-heal for the F1 pages. F1 has no reliable scheduled path —
 * backfill-f1 isn't wired into vercel.json, and Hobby crons fire unreliably
 * anyway — so the page keeps itself fresh from the free, no-auth Jolpica API.
 * Runs AFTER the response via `after` (never adds page latency) and throttles
 * through a PollLog slot claimed up front, so a burst of views (or a cold DB
 * hit by many users at once) triggers at most one refresh per window instead of
 * a stampede of parallel full-season backfills. Mirrors the UFC on-view
 * self-heal (see refreshUpcoming.ts) — the pattern that actually works here,
 * unlike the previous fire-and-forget, which Vercel kills once the response
 * returns (the same bug the UFC feed hit).
 *
 * Cold start (empty DB) seeds the calendar AND this season's results in one
 * pass; steady state pulls the calendar when no upcoming race is known and
 * backfills results when a race has run but its classification is still missing.
 */
const JOB_NAME = "sync-f1-on-view";
const STALE_MINUTES = 6 * 60;

export function refreshF1OnView(now: Date = new Date()): void {
  after(async () => {
    try {
      const log = await prisma.pollLog.findUnique({ where: { jobName: JOB_NAME } });
      if (!shouldPollNow(log?.lastPolledAt ?? null, STALE_MINUTES, now)) return;

      // Claim the slot immediately so concurrent views don't all re-ingest.
      await recordPollLog(JOB_NAME, "refreshing (on-view)");

      const season = now.getUTCFullYear();
      const [total, futureCount, pastMissing] = await Promise.all([
        prisma.f1Race.count(),
        prisma.f1Race.count({ where: { raceDate: { gt: now } } }),
        prisma.f1Race.count({ where: { raceDate: { lt: now }, results: { none: {} } } }),
      ]);

      if (total === 0) {
        // Cold DB: seed the calendar AND this season's results in one pass.
        await ingestSeasonSchedule(season);
        await backfillF1History(season, season);
      } else {
        // No upcoming race on the books → pull the calendar so "next race" fills in.
        if (futureCount === 0) await ingestSeasonSchedule(season);
        // A race has run but we never ingested its results → backfill this season.
        if (pastMissing > 0) await backfillF1History(season, season);
      }

      await recordPollLog(JOB_NAME, `ok (on-view: season ${season})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordPollLog(JOB_NAME, `error (on-view): ${message}`);
    }
  });
}
