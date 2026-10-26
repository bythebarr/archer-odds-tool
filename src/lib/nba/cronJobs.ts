/**
 * The NBA jobs that ride existing cron ticks (see RideAlongJob): props on the odds
 * poll, game logs on the results sync. Each records its own PollLog row so the
 * props page's freshness stamp and a failure are visible on their own.
 */
import { recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { lookbackDatesEt } from "@/lib/teamLeague/results";
import { pollAndStoreNbaProps } from "./props";
import { syncNbaGameLogs } from "./gameLogs";
import { syncNbaPositions } from "./positions";
import { syncInjuries } from "@/lib/injuries/espnInjuries";
import { pollExtraMarkets } from "@/lib/teamLeague/extraMarkets";
import { NBA_LEAGUE } from "./league";

/**
 * Alternates, team totals, halves and quarters for games starting soon — on the
 * same tick as props, logged on their own so a market-key change shows up there.
 */
const NBA_MARKETS_JOB = "poll-markets-nba";
const NBA_MARKETS_LOOKAHEAD_HOURS = 14;
export async function runNbaExtraMarketsPoll() {
  try {
    const summary = await pollExtraMarkets(NBA_LEAGUE, NBA_MARKETS_LOOKAHEAD_HOURS);
    if (summary.rejectedKeys.length) console.log(`${NBA_MARKETS_JOB}: provider rejected`, summary.rejectedKeys);
    await recordPollLog(
      NBA_MARKETS_JOB,
      summary.gamesConsidered === 0 ? "ok (no games)" : writeOutcomeStatus(summary.gamesConsidered, summary.gamesStored, "games with extra markets"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    return summary;
  } catch (error) {
    await recordPollLog(NBA_MARKETS_JOB, `error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
    throw error;
  }
}

const NBA_PROPS_JOB = "poll-props-nba";
const NBA_GAME_LOGS_JOB = "sync-gamelogs-nba";

async function logged<T>(jobName: string, run: () => Promise<{ summary: T; status: string; credits?: [number | null, number | null] }>): Promise<T> {
  try {
    const { summary, status, credits } = await run();
    await recordPollLog(jobName, status, credits?.[0], credits?.[1]);
    return summary;
  } catch (error) {
    await recordPollLog(jobName, `error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
    throw error;
  }
}

export function runNbaPropsPoll() {
  return logged(NBA_PROPS_JOB, async () => {
    // The injury report first (free): tonight's props are read against it.
    const injuries = await syncInjuries("nba").catch((error: unknown) => ({ error: String(error) }));
    const summary = { ...(await pollAndStoreNbaProps()), injuries };
    if (Object.keys(summary.unmappedMarketKeys).length) {
      // The list to read when a market seems missing from the board.
      console.log(`${NBA_PROPS_JOB}: unmapped market keys`, summary.unmappedMarketKeys);
    }
    const status =
      summary.status === "ok"
        ? writeOutcomeStatus(summary.rowsFetched, summary.quotesStored, "prop quotes")
        : `ok (${summary.status})`;
    return { summary, status, credits: [summary.creditsUsed, summary.creditsRemaining] };
  });
}

export function runNbaGameLogSync() {
  return logged(NBA_GAME_LOGS_JOB, async () => {
    const logs = await syncNbaGameLogs(lookbackDatesEt(new Date()));
    // Positions after logs, so tonight's new players and logs are covered. A roster
    // fetch failing costs only the by-position split, never the logs, so it's caught.
    const positions = await syncNbaPositions().catch((error: unknown) => ({ error: String(error) }));
    const summary = { ...logs, positions };
    // Already-logged games are skipped, so "considered" is the games that still needed logs.
    const needed = logs.gamesLogged + logs.failures.length;
    return { summary, status: writeOutcomeStatus(needed, logs.gamesLogged, "games logged") };
  });
}
