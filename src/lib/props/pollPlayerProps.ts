import { prisma } from "@/lib/prisma";
import {
  fetchEventPlayerProps,
  fetchBulkPlayerProps,
  activeOddsProvider,
} from "@/lib/odds/oddsApiClient";
import { groupPropRows } from "./parlayProps";
import { hasCreditsHeadroom } from "@/lib/pollingPolicy";
import { buildPlayerNameIndex, storePlayerPropOdds } from "./storePropOdds";
import { ALL_PLAYER_PROP_MARKET_KEYS, PLAYER_PROP_REGIONS } from "./propMarkets";

/**
 * Safety cap per invocation — MLB never exceeds ~16 games/day, but this
 * bounds worst-case spend/runtime if this is ever manually triggered
 * more than once in a day, rather than relying solely on the
 * already-polled-today dedup below.
 */
const MAX_GAMES_PER_RUN = 20;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface PollPlayerPropsSummary {
  gamesConsidered: number;
  gamesPolled: number;
  gamesSkippedLowCredits: number;
  snapshotsWritten: number;
  unmatchedPlayerNames: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches and stores player-prop odds for every not-yet-started MLB game in
 * the next 24h that hasn't already had props fetched today — the "full
 * fidelity, 1 region" scope decided in the credit-budget conversation (see
 * odds_api_credit_budget memory): all 11 StatCategory markets, `us` region
 * only, once per game per day. Unlike game-lines' bulk endpoint, props cost
 * `markets x regions` PER GAME fetched (see propMarkets.ts), so this loops
 * one per-event call per game rather than a single bulk call — and checks
 * the account-wide credits guardrail before each individual game's fetch,
 * not just once at the start, so a slate that runs the account low partway
 * through still stops rather than overspending.
 */
export async function pollAndStorePlayerProps(now: Date = new Date()): Promise<PollPlayerPropsSummary> {
  const lookahead = new Date(now.getTime() + 24 * 3_600_000);
  const todayStart = startOfUtcDay(now);

  const candidateGames = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "scheduled",
      scheduledStartUtc: { gte: now, lte: lookahead },
      oddsApiEventId: { not: null },
    },
    orderBy: { scheduledStartUtc: "asc" },
  });

  const alreadyPolledToday = await prisma.playerPropSnapshot.findMany({
    where: {
      gameId: { in: candidateGames.map((game) => game.id) },
      polledAt: { gte: todayStart },
    },
    select: { gameId: true },
    distinct: ["gameId"],
  });
  const alreadyPolledGameIds = new Set(alreadyPolledToday.map((row) => row.gameId));

  const gamesToPoll = candidateGames
    .filter((game) => !alreadyPolledGameIds.has(game.id))
    .slice(0, MAX_GAMES_PER_RUN);

  let gamesPolled = 0;
  let gamesSkippedLowCredits = 0;
  let snapshotsWritten = 0;
  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  const unmatchedPlayerNames = new Set<string>();

  // Built once and reused across every game in this run — see
  // buildPlayerNameIndex's docstring for why (avoids a DB query per
  // distinct player name across the whole slate).
  const playerNameIndex = gamesToPoll.length > 0 ? await buildPlayerNameIndex() : null;

  // ParlayAPI returns EVERY prop for the sport in one 3-credit call, so the
  // per-game loop below (TOA's only option, at markets x regions PER GAME —
  // ~165 credits for a 15-game slate) collapses into a single request. This is
  // the biggest single cost saving in the provider switch, and props are the
  // surviving edge, so it's the one that matters.
  if (activeOddsProvider() === "parlay" && gamesToPoll.length > 0) {
    try {
      const bulk = await fetchBulkPlayerProps("baseball_mlb");
      const { byEventId, skipped } = groupPropRows(bulk.rows);
      if (skipped.dfs || skipped.noLine || skipped.noPrice) {
        console.log(
          `props: skipped ${skipped.dfs} DFS, ${skipped.noLine} no-line, ${skipped.noPrice} unpriced row(s)`
        );
      }

      for (const game of gamesToPoll) {
        const bookmakers = byEventId.get(game.oddsApiEventId!);
        if (!bookmakers) continue; // no props for this game in the feed
        const result = await storePlayerPropOdds(game.id, bookmakers, playerNameIndex!);
        snapshotsWritten += result.snapshotsWritten;
        result.unmatchedPlayerNames.forEach((name) => unmatchedPlayerNames.add(name));
        gamesPolled++;
      }

      return {
        gamesConsidered: candidateGames.length,
        gamesPolled,
        gamesSkippedLowCredits: 0,
        snapshotsWritten,
        unmatchedPlayerNames: [...unmatchedPlayerNames],
        creditsUsed: bulk.creditsUsed,
        creditsRemaining: bulk.creditsRemaining,
      };
    } catch (error) {
      // Fall through to the per-game path rather than losing the slate — the
      // TOA-shaped endpoint still exists on both providers.
      console.error("Bulk props fetch failed, falling back to per-game:", error);
    }
  }

  for (const game of gamesToPoll) {
    if (!(await hasCreditsHeadroom())) {
      gamesSkippedLowCredits = gamesToPoll.length - gamesPolled;
      break;
    }

    try {
      // oddsApiEventId is guaranteed non-null by the query filter above.
      const { event, creditsUsed: eventCreditsUsed, creditsRemaining: eventCreditsRemaining } =
        await fetchEventPlayerProps(game.oddsApiEventId!, ALL_PLAYER_PROP_MARKET_KEYS, PLAYER_PROP_REGIONS);

      const result = await storePlayerPropOdds(game.id, event.bookmakers, playerNameIndex!);
      snapshotsWritten += result.snapshotsWritten;
      result.unmatchedPlayerNames.forEach((name) => unmatchedPlayerNames.add(name));

      if (eventCreditsUsed !== null) creditsUsed += eventCreditsUsed;
      if (eventCreditsRemaining !== null) creditsRemaining = eventCreditsRemaining;
    } catch (error) {
      // One game's props fetch failing shouldn't abort the whole run — the
      // rest of the slate can still get polled (same philosophy as
      // ingest.ts's alt-line fetch try/catch).
      console.error(`Player-props fetch failed for game ${game.id}:`, error);
    }

    gamesPolled++;
  }

  return {
    gamesConsidered: candidateGames.length,
    gamesPolled,
    gamesSkippedLowCredits,
    snapshotsWritten,
    unmatchedPlayerNames: [...unmatchedPlayerNames],
    creditsUsed,
    creditsRemaining,
  };
}
