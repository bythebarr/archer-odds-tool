import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordPollLog, shouldPollNow } from "@/lib/pollingPolicy";
import { pollAndStoreUfcOdds } from "./oddsIngest";

/**
 * On-view refresh for UFC moneyline odds — same pattern as
 * refreshUpcomingUfcOnView, but this one DOES spend Odds API credits (one
 * bulk h2h call per refresh), so it records creditsRemaining into the PollLog
 * for the account-wide budget guardrail. Runs AFTER the response via `after`,
 * so it never adds page latency, and claims the PollLog slot immediately so
 * concurrent viewers don't all re-poll. A 3h staleness window keeps it to a
 * few credits on a fight week while still catching meaningful line movement.
 */
const JOB_NAME = "poll-ufc-odds";
const STALE_MINUTES = 3 * 60;

export function refreshUfcOddsOnView(now: Date = new Date()): void {
  after(async () => {
    try {
      const log = await prisma.pollLog.findUnique({ where: { jobName: JOB_NAME } });
      if (!shouldPollNow(log?.lastPolledAt ?? null, STALE_MINUTES, now)) return;

      await recordPollLog(JOB_NAME, "refreshing (on-view)");
      const summary = await pollAndStoreUfcOdds();
      await recordPollLog(
        JOB_NAME,
        `ok (on-view: ${summary.boutsMatched}/${summary.eventsFetched} events matched, ${summary.rowsWritten} rows)`,
        summary.creditsUsed,
        summary.creditsRemaining
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(JOB_NAME, `error (on-view): ${message}`);
    }
  });
}
