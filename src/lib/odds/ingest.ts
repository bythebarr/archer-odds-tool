import { prisma } from "@/lib/prisma";
import {
  fetchMlbOdds,
  fetchEventAlternateOdds,
  type OddsApiEvent,
  type OddsApiMarketKey,
} from "./oddsApiClient";
import { storeBookmakerOdds } from "./storeOdds";
import { IMMINENT_THRESHOLD_MINUTES } from "@/lib/pollingPolicy";

/** Games are matched to Odds API events within this window around commence_time. */
const MATCH_WINDOW_HOURS = 6;

/**
 * Finds the Game a given Odds API event refers to. Once matched, the event id
 * is cached on Game.oddsApiEventId so future polls skip the fuzzy lookup.
 */
async function matchGameForEvent(event: OddsApiEvent) {
  // sport: "mlb" everywhere here: this function is only ever called from the
  // MLB odds poll flow (fetchMlbOdds) — tennis creates its own Game rows on
  // the fly instead of matching pre-existing ones (see tennis/ingest.ts).
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id, sport: "mlb" } });
  if (existing) return existing;

  const commenceTime = new Date(event.commence_time);
  const windowStart = new Date(commenceTime.getTime() - MATCH_WINDOW_HOURS * 3_600_000);
  const windowEnd = new Date(commenceTime.getTime() + MATCH_WINDOW_HOURS * 3_600_000);

  const candidates = await prisma.game.findMany({
    where: {
      sport: "mlb",
      scheduledStartUtc: { gte: windowStart, lte: windowEnd },
      homeTeam: { name: event.home_team },
      awayTeam: { name: event.away_team },
    },
  });

  const game = candidates[0];
  if (!game) return null;

  await prisma.game.update({ where: { id: game.id }, data: { oddsApiEventId: event.id } });
  return game;
}

export interface PollOddsSummary {
  eventsFetched: number;
  gamesMatched: number;
  gamesUnmatched: string[];
  snapshotsWritten: number;
  altLineGamesPolled: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current MLB odds and archives them (see storeBookmakerOdds for the
 * write shape). Only books in ALLOWED_BOOK_KEYS are stored.
 *
 * Alt lines (alternate_spreads/alternate_totals) aren't part of the bulk
 * fetch — The Odds API only serves them one event at a time, at ~4 credits
 * per game (2 markets x 2 regions), which is too expensive to fetch for
 * every game on every poll. Instead, once the main bulk odds are matched to
 * games, any game starting within IMMINENT_THRESHOLD_MINUTES gets one extra
 * per-event call for its alt lines — bounding the extra cost to however many
 * games are actually close to first pitch right now, not the whole slate.
 */
export async function pollAndStoreOdds(
  markets: OddsApiMarketKey[] = ["h2h", "spreads", "totals"]
): Promise<PollOddsSummary> {
  const { events, creditsUsed: mainCreditsUsed, creditsRemaining: mainCreditsRemaining } =
    await fetchMlbOdds(markets);

  let gamesMatched = 0;
  let snapshotsWritten = 0;
  let altLineGamesPolled = 0;
  let creditsUsed = mainCreditsUsed ?? 0;
  let creditsRemaining = mainCreditsRemaining;
  const gamesUnmatched: string[] = [];
  const now = new Date();

  for (const event of events) {
    const game = await matchGameForEvent(event);
    if (!game) {
      gamesUnmatched.push(`${event.away_team} @ ${event.home_team} (${event.commence_time})`);
      continue;
    }
    gamesMatched++;

    // The Odds API's odds endpoint includes in-play events by default, not
    // just upcoming ones — once first pitch passes, its "h2h" price reflects
    // the live game state (e.g. -10000/+1500 in a blowout), not a shoppable
    // pregame line. We only do pregame line-shopping, so skip storing
    // anything for a game that's already started rather than let a live
    // price silently overwrite CurrentOddsLine as if it were still current.
    const minutesToStart = (game.scheduledStartUtc.getTime() - now.getTime()) / 60_000;
    if (minutesToStart < 0) continue;

    snapshotsWritten += await storeBookmakerOdds(
      game.id,
      event.home_team,
      event.away_team,
      event.bookmakers
    );

    const isImminent = minutesToStart <= IMMINENT_THRESHOLD_MINUTES;
    if (!isImminent) continue;

    try {
      const altResult = await fetchEventAlternateOdds(event.id);
      snapshotsWritten += await storeBookmakerOdds(
        game.id,
        altResult.event.home_team,
        altResult.event.away_team,
        altResult.event.bookmakers
      );
      altLineGamesPolled++;
      if (altResult.creditsUsed !== null) creditsUsed += altResult.creditsUsed;
      if (altResult.creditsRemaining !== null) creditsRemaining = altResult.creditsRemaining;
    } catch (error) {
      // One game's alt-line fetch failing shouldn't abort the whole poll —
      // the main line for this game already landed above.
      console.error(`Alt-line fetch failed for event ${event.id}:`, error);
    }
  }

  return {
    eventsFetched: events.length,
    gamesMatched,
    gamesUnmatched,
    snapshotsWritten,
    altLineGamesPolled,
    creditsUsed,
    creditsRemaining,
  };
}
