import { prisma } from "@/lib/prisma";
import {
  fetchMlbOdds,
  fetchEventAlternateOdds,
  type OddsApiEvent,
  type OddsApiMarketKey,
} from "./oddsApiClient";
import { storeBookmakerOdds } from "./storeOdds";
import type { Game } from "@/generated/prisma/client";

/** Games are matched to Odds API events within this window around commence_time. */
const MATCH_WINDOW_HOURS = 6;

/**
 * How many games get an alt-line fetch per poll, capped at a fixed number
 * rather than "every game within N minutes of first pitch" — the fixed
 * 60-min-before-first-pitch gate this replaced rarely lined up with the
 * fixed 2x/day poll schedule (most games start hours away from either fixed
 * poll time), so alt lines effectively never populated in practice. This
 * instead always fetches alt lines for the single soonest-starting
 * not-yet-started game seen this poll — bounded to a known, budgeted cost
 * (currently 1 game x 4 credits x 2 polls/day = ~240 credits/mo) rather than
 * scaling with slate size (an uncapped "every game before the next poll"
 * version was costed at ~2,160 credits/mo against a ~500/mo plan — see the
 * conversation this was added in). Raise this only after confirming real
 * plan headroom on the Odds API dashboard, not the ~500/mo figure in these
 * comments, which is unverified.
 */
const MAX_ALT_LINE_GAMES_PER_POLL = 1;

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
 * per game (2 markets x 2 regions). Once the main bulk odds are matched and
 * stored for every game, the MAX_ALT_LINE_GAMES_PER_POLL soonest-starting
 * not-yet-started game(s) also get one extra per-event call for alt lines —
 * see that constant's comment for why it's a fixed cap rather than a
 * proximity-to-first-pitch window.
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

  const upcomingMatches: { event: OddsApiEvent; game: Game; minutesToStart: number }[] = [];

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

    upcomingMatches.push({ event, game, minutesToStart });
  }

  const altLineTargets = upcomingMatches
    .sort((a, b) => a.minutesToStart - b.minutesToStart)
    .slice(0, MAX_ALT_LINE_GAMES_PER_POLL);

  for (const { event, game } of altLineTargets) {
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
