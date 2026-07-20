import { prisma } from "@/lib/prisma";
import { fetchOdds, fetchSportsList, type OddsApiEvent, type OddsApiMarketKey } from "@/lib/odds/oddsApiClient";
import { storeBookmakerOdds } from "@/lib/odds/storeOdds";
import { PREFERRED_TENNIS_SPORT_KEY, FALLBACK_TENNIS_SPORT_KEY } from "./tournamentAllowlist";
import { surfaceForSportKey } from "./surface";

/** h2h only (match winner) — see the tennis plan doc's credit budget and non-goals. */
const TENNIS_MARKETS: OddsApiMarketKey[] = ["h2h"];
/** Same US-legal-books-only regions as MLB — see bookAllowlist.ts. */
const TENNIS_REGIONS = ["us", "us2"];

/**
 * Picks which allowlisted tournament to poll this cycle: prefers ATP, falls
 * back to WTA if ATP isn't currently active, returns null if neither is
 * (between tournaments). Doesn't compare actual match counts to find the
 * "busier" draw — that would require an /odds call per tour (2 credits
 * each) just to decide, doubling the daily cost. See the tennis plan doc.
 */
export async function resolveActiveTennisSportKey(): Promise<string | null> {
  const sports = await fetchSportsList();
  const byKey = new Map(sports.map((s) => [s.key, s]));

  if (byKey.get(PREFERRED_TENNIS_SPORT_KEY)?.active) return PREFERRED_TENNIS_SPORT_KEY;
  if (byKey.get(FALLBACK_TENNIS_SPORT_KEY)?.active) return FALLBACK_TENNIS_SPORT_KEY;
  return null;
}

async function upsertPlayer(name: string) {
  return prisma.player.upsert({
    where: { oddsApiName: name },
    create: { name, oddsApiName: name },
    update: {},
  });
}

/**
 * Finds or creates the Game row for a tennis match event. Unlike MLB's
 * matchGameForEvent, there's no separate free schedule source to reconcile
 * against — the odds poll itself is the source of truth for which matches
 * exist, keyed by the Odds API's own event id (known at creation, so no
 * fuzzy name/time-window matching is needed the way MLB's is).
 */
async function upsertMatchForEvent(event: OddsApiEvent, surface: string | null) {
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id, sport: "tennis" } });
  if (existing) {
    // Backfill surface onto a match created before we tracked it (or by an earlier
    // poll that couldn't resolve the tournament); never overwrite a known surface.
    if (existing.surface === null && surface !== null) {
      return prisma.game.update({ where: { id: existing.id }, data: { surface } });
    }
    return existing;
  }

  const [homePlayer, awayPlayer] = await Promise.all([
    upsertPlayer(event.home_team),
    upsertPlayer(event.away_team),
  ]);

  return prisma.game.create({
    data: {
      sport: "tennis",
      oddsApiEventId: event.id,
      season: new Date(event.commence_time).getUTCFullYear(),
      scheduledStartUtc: new Date(event.commence_time),
      surface,
      homePlayerId: homePlayer.id,
      awayPlayerId: awayPlayer.id,
    },
  });
}

export interface PollTennisOddsSummary {
  sportKeyPolled: string | null;
  eventsFetched: number;
  matchesStored: number;
  snapshotsWritten: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current tennis odds for whichever allowlisted tournament is
 * active this cycle and archives them (see storeBookmakerOdds for the write
 * shape, shared unchanged with MLB). h2h only, us/us2 regions — see the
 * tennis plan doc's credit budget and non-goals for why.
 */
export async function pollAndStoreTennisOdds(): Promise<PollTennisOddsSummary> {
  const sportKey = await resolveActiveTennisSportKey();
  if (!sportKey) {
    return {
      sportKeyPolled: null,
      eventsFetched: 0,
      matchesStored: 0,
      snapshotsWritten: 0,
      creditsUsed: null,
      creditsRemaining: null,
    };
  }

  const { events, creditsUsed, creditsRemaining } = await fetchOdds(sportKey, TENNIS_MARKETS, TENNIS_REGIONS);
  const surface = surfaceForSportKey(sportKey); // one tournament per poll → one surface

  let matchesStored = 0;
  let snapshotsWritten = 0;
  const now = new Date();

  for (const event of events) {
    // Same rule as MLB's pollAndStoreOdds: skip matches already underway —
    // the Odds API's h2h price reflects live match state once play starts,
    // not a shoppable pregame line.
    const minutesToStart = (new Date(event.commence_time).getTime() - now.getTime()) / 60_000;
    if (minutesToStart < 0) continue;

    const match = await upsertMatchForEvent(event, surface);
    matchesStored++;
    snapshotsWritten += await storeBookmakerOdds(match.id, event.home_team, event.away_team, event.bookmakers);
  }

  return {
    sportKeyPolled: sportKey,
    eventsFetched: events.length,
    matchesStored,
    snapshotsWritten,
    creditsUsed,
    creditsRemaining,
  };
}
