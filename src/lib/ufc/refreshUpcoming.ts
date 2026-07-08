import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordPollLog, shouldPollNow } from "@/lib/pollingPolicy";
import { backfillUpcomingUfcEvents } from "./backfillUfc";

/**
 * On-view self-heal for the upcoming-UFC feed. The scheduled paths (the daily
 * backfill-ufc cron and the sync-results staleness catch — see
 * UFC_UPCOMING_STALE_MINUTES there) both ride Vercel crons, which on Hobby fire
 * unreliably/late, so upcoming cards can just never show up. This closes that
 * gap from the read side: whenever the Slate or /ufc page is viewed and the
 * feed is stale, refresh it AFTER the response (via `after`, so it never adds
 * to page latency). Shares the `sync-ufc-upcoming` PollLog with the cron catch,
 * so the two coordinate and it stays ~one cheap Cito call per staleness window.
 */
const JOB_NAME = "sync-ufc-upcoming";
const STALE_MINUTES = 20 * 60;

export function refreshUpcomingUfcOnView(now: Date = new Date()): void {
  after(async () => {
    try {
      const log = await prisma.pollLog.findUnique({ where: { jobName: JOB_NAME } });
      if (!shouldPollNow(log?.lastPolledAt ?? null, STALE_MINUTES, now)) return;

      // Claim the slot immediately so concurrent views don't all re-ingest.
      await recordPollLog(JOB_NAME, "refreshing (on-view)");
      const summary = await backfillUpcomingUfcEvents();
      await recordPollLog(JOB_NAME, `ok (on-view: ${summary.eventsProcessed} events, ${summary.boutsProcessed} bouts)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(JOB_NAME, `error (on-view): ${message}`);
    }
  });
}
