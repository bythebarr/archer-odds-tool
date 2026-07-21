import { prisma } from "@/lib/prisma";
import {
  fetchEventPlayerProps,
  fetchBulkPlayerProps,
  activeOddsProvider,
  type OddsApiBookmaker,
} from "@/lib/odds/oddsApiClient";
import { groupPropRows } from "./parlayProps";
import { matchPropEventsToGames } from "./eventMatch";
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

  // No `oddsApiEventId` requirement any more. It used to be the join key, but
  // props are matched by team now (eventMatch.ts), so demanding an id would
  // only shrink coverage to games the game-lines feed happens to carry — on
  // 2026-07-21 that was 5 of 15. A game with props and no moneyline is still a
  // game we want props for.
  const candidateGames = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "scheduled",
      scheduledStartUtc: { gte: now, lte: lookahead },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
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

  // Team names are the props matcher's only usable join key. A game missing
  // either side can't be matched, so it's excluded rather than half-matched.
  const matchableGames = gamesToPoll
    .filter((game) => game.homeTeam && game.awayTeam)
    .map((game) => ({
      id: game.id,
      homeTeamName: game.homeTeam!.name,
      awayTeamName: game.awayTeam!.name,
      scheduledStartUtc: game.scheduledStartUtc,
    }));

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
      const { byEventId, eventTeams, skipped } = groupPropRows(bulk.rows);
      console.log(
        `props: ${bulk.rows.length} rows · skipped ${skipped.dfs} DFS, ${skipped.noLine} no-line, ` +
          `${skipped.noPrice} unpriced, ${skipped.unmappedMarket} unmapped-market, ${skipped.notAPlayer} not-a-player, ${skipped.incoherent} implausible`
      );

      // Bind by teams, NOT by id: the props feed and the game-lines feed don't
      // share an event-id namespace, so `oddsApiEventId` matches nothing here.
      // See eventMatch.ts for the evidence and the matching rules.
      const { eventIdToGameId, unmatched } = matchPropEventsToGames(
        [...eventTeams].map(([eventId, teams]) => ({ eventId, ...teams })),
        matchableGames
      );
      if (unmatched.length) {
        console.warn(
          `props: ${unmatched.length} feed event(s) not bound to a game:`,
          unmatched.map((u) => `${u.label} (${u.reason})`)
        );
      }

      // One game can be named by several feed events — Parlay duplicates them —
      // so collect every event's books per game before storing once.
      const booksByGame = new Map<string, OddsApiBookmaker[]>();
      for (const [eventId, gameId] of eventIdToGameId) {
        const bookmakers = byEventId.get(eventId);
        if (!bookmakers) continue;
        booksByGame.set(gameId, [...(booksByGame.get(gameId) ?? []), ...bookmakers]);
      }

      for (const [gameId, bookmakers] of booksByGame) {
        const result = await storePlayerPropOdds(gameId, bookmakers, playerNameIndex!);
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
    // The per-event endpoint is addressed BY id, so this path still needs one.
    // The candidate query no longer guarantees it (the bulk path matches on
    // teams instead), so a game without one is skipped rather than assumed.
    if (!game.oddsApiEventId) continue;

    if (!(await hasCreditsHeadroom())) {
      gamesSkippedLowCredits = gamesToPoll.length - gamesPolled;
      break;
    }

    try {
      const { event, creditsUsed: eventCreditsUsed, creditsRemaining: eventCreditsRemaining } =
        await fetchEventPlayerProps(game.oddsApiEventId, ALL_PLAYER_PROP_MARKET_KEYS, PLAYER_PROP_REGIONS);

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
