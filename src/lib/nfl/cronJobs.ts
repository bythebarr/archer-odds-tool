/**
 * The NFL jobs that ride existing cron ticks (see RideAlongJob): game logs on
 * the results sync, props on the odds poll — the NBA arrangement. Each records
 * its own PollLog row, so freshness and failures show on their own.
 */
import { recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { lookbackDatesEt } from "@/lib/teamLeague/results";
import { syncNflGameLogs, syncNflPositions } from "./gameLogs";
import { pollAndStoreNflProps } from "./props";
import { syncInjuries } from "@/lib/injuries/espnInjuries";

const NFL_GAME_LOGS_JOB = "sync-gamelogs-nfl";

export async function runNflGameLogSync() {
  try {
    const logs = await syncNflGameLogs(lookbackDatesEt(new Date()));
    const positions = await syncNflPositions().catch((error: unknown) => ({ error: String(error) }));
    const needed = logs.gamesLogged + logs.failures.length;
    await recordPollLog(NFL_GAME_LOGS_JOB, writeOutcomeStatus(needed, logs.gamesLogged, "games logged"));
    return { ...logs, positions };
  } catch (error) {
    await recordPollLog(NFL_GAME_LOGS_JOB, `error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
    throw error;
  }
}

const NFL_PROPS_JOB = "poll-props-nfl";

export async function runNflPropsPoll() {
  try {
    const injuries = await syncInjuries("nfl").catch((error: unknown) => ({ error: String(error) }));
    const summary = { ...(await pollAndStoreNflProps()), injuries };
    if (Object.keys(summary.unmappedMarketKeys).length) console.log(`${NFL_PROPS_JOB}: unmapped market keys`, summary.unmappedMarketKeys);
    await recordPollLog(
      NFL_PROPS_JOB,
      summary.gamesConsidered === 0 ? "ok (no games)" : writeOutcomeStatus(summary.rowsFetched, summary.quotesStored, "prop quotes"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    return summary;
  } catch (error) {
    await recordPollLog(NFL_PROPS_JOB, `error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
    throw error;
  }
}
