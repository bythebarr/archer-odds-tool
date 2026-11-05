/**
 * The NFL jobs that ride existing cron ticks (see RideAlongJob): game logs on
 * the results sync, props on the odds poll — the NBA arrangement. Each records
 * its own PollLog row, so freshness and failures show on their own.
 */
import { getLatestCreditsRemaining, recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { lookbackDatesEt } from "@/lib/teamLeague/results";
import { syncNflGameLogs, syncNflPositions } from "./gameLogs";
import { pollAndStoreNflProps } from "./props";
import { syncInjuries } from "@/lib/injuries/espnInjuries";
import { pollExtraMarkets } from "@/lib/teamLeague/extraMarkets";
import { NFL_LEAGUE } from "./league";

/**
 * Alternates, team totals, halves and quarters for games starting soon — on the
 * same tick as props, logged on their own so a market-key change shows up there.
 */
const NFL_MARKETS_JOB = "poll-markets-nfl";
const NFL_MARKETS_LOOKAHEAD_HOURS = 30;
/**
 * One pass over a Sunday slate costs ~320 credits, more than half a small
 * plan's month (on 2026-11-01 it left 17 for everything else). Below this the
 * credits go to player-prop prices, which the props board can't get anywhere
 * else; ESPN's free board already carries every game's main lines.
 */
export const NFL_MARKETS_MIN_CREDITS = 2000;
export async function runNflExtraMarketsPoll() {
  try {
    const credits = await getLatestCreditsRemaining();
    if (credits !== null && credits < NFL_MARKETS_MIN_CREDITS) {
      await recordPollLog(NFL_MARKETS_JOB, `skipped: ${credits} credits left (needs ${NFL_MARKETS_MIN_CREDITS}; props come first)`);
      return { skipped: true, creditsRemaining: credits };
    }
    const summary = await pollExtraMarkets(NFL_LEAGUE, NFL_MARKETS_LOOKAHEAD_HOURS);
    if (summary.rejectedKeys.length) console.log(`${NFL_MARKETS_JOB}: provider rejected`, summary.rejectedKeys);
    await recordPollLog(
      NFL_MARKETS_JOB,
      summary.gamesConsidered === 0 ? "ok (no games)" : writeOutcomeStatus(summary.gamesConsidered, summary.gamesStored, "games with extra markets"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    return summary;
  } catch (error) {
    await recordPollLog(NFL_MARKETS_JOB, `error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
    throw error;
  }
}

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
