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

/**
 * Poll + store UFC odds IF the shared PollLog window is stale, else no-op. The
 * synchronous core shared by the on-view refresh (below) and the Discord poster
 * (which needs fresh lines before building its Archer EV card, and runs in a
 * cron where `after` isn't appropriate). One PollLog (`poll-ufc-odds`)
 * coordinates every caller, so it stays ~2 credits per staleness window no
 * matter how many paths trigger it. Throws are the caller's to handle.
 */
export async function ensureUfcOddsFresh(now: Date = new Date()): Promise<void> {
  const log = await prisma.pollLog.findUnique({ where: { jobName: JOB_NAME } });
  if (!shouldPollNow(log?.lastPolledAt ?? null, STALE_MINUTES, now)) return;

  await recordPollLog(JOB_NAME, "refreshing");
  const summary = await pollAndStoreUfcOdds();
  await recordPollLog(
    JOB_NAME,
    `ok (${summary.boutsMatched}/${summary.eventsFetched} events matched, ${summary.rowsWritten} rows)`,
    summary.creditsUsed,
    summary.creditsRemaining
  );
}

export function refreshUfcOddsOnView(now: Date = new Date()): void {
  after(async () => {
    try {
      await ensureUfcOddsFresh(now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(JOB_NAME, `error (on-view): ${message}`);
    }
  });
}
