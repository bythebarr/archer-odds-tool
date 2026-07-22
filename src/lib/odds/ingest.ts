import { prisma } from "@/lib/prisma";
import {
  fetchMlbOdds,
  fetchEventAlternateOdds,
  activeOddsProvider,
  type OddsApiEvent,
  type OddsApiMarketKey,
} from "./oddsApiClient";
import { storeBookmakerOdds } from "./storeOdds";
import { canonicalTeamName } from "./teamNameAliases";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { oddsProviderForSport } from "@/lib/odds/providers/registry";
import { fetchOddsBlazeGameOdds } from "@/lib/odds/providers/oddsblaze";
import type { Game } from "@/generated/prisma/client";

/**
 * Games are matched to odds events by ET CALENDAR DATE, not by a clock window,
 * because ParlayAPI's `commence_time` is not trustworthy.
 *
 * Measured 2026-07-21 against the authoritative MLB Stats API schedule: the feed
 * is **exactly 6 hours early for every game starting at or after 00:00 UTC**, and
 * exactly right for the rest.
 *
 *   MIN @ CLE   truth 22:40Z   feed 22:40Z   ok
 *   PIT @ NYY   truth 23:05Z   feed 23:05Z   ok
 *   DET @ CHC   truth 00:05Z   feed 18:05Z   6h early
 *   WSH @ COL   truth 00:40Z   feed 18:40Z   6h early
 *   STL @ LAA   truth 01:38Z   feed 19:38Z   6h early
 *
 * So roughly half of a normal slate is misdated by the provider. A time window
 * can only be wrong here in one of two ways: narrow enough to reject the real
 * game (7 of 15 events went unmatched at 3h), or wide enough to also reach a
 * neighbouring game and merge two markets into one board.
 *
 * Every one of those games IS on the same ET date under both clocks — a 6h-early
 * evening game lands in the same ET afternoon — and ET is already how the rest of
 * this app dates a slate. So the ET day is the match key, and start time is kept
 * only to order a doubleheader's two games within that day.
 */

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
 * Assigns each odds event to the Game it actually refers to, one-to-one.
 *
 * This replaces a per-event `candidates[0]` lookup that produced corrupted
 * boards, measured 2026-07-21 on WSH @ COL: the stored game held two mutually
 * exclusive markets from a single poll — FanDuel/Pinnacle/Novig pricing a
 * pick'em (~-105 both sides) alongside BetMGM/Caesars/Parx pricing Washington
 * at -275. Every book was internally coherent, so the overround guard in
 * marketSanity couldn't see it; the books were simply pricing DIFFERENT GAMES.
 *
 * The cause was a split doubleheader. Two events, six hours apart, both fell
 * inside the other's +/-6h window, and nothing stopped both from claiming the
 * same row — the first-listed candidate won each time, and `oddsApiEventId` was
 * simply overwritten. Best-price line shopping across two different games is
 * worse than useless: it manufactures an enormous fake edge on every market.
 *
 * Two changes make that unrepresentable rather than unlikely:
 *
 *  1. **Closest start wins, assigned globally.** Every (event, candidate) pair
 *     is ranked by start-time distance and assigned greedily, so an exact time
 *     match always beats a six-hour-away one no matter what order the feed
 *     lists events in. `candidates[0]` had no ordering at all.
 *  2. **One game, one event.** A game already claimed this poll can't be
 *     claimed again, so two events can never merge into one row.
 *
 * Events whose id is already cached on a Game keep that binding and are
 * excluded from the assignment, which is both cheaper and stable across polls.
 */
async function assignEventsToGames(
  events: OddsApiEvent[]
): Promise<{ matches: Map<string, Game>; unmatched: OddsApiEvent[] }> {
  const matches = new Map<string, Game>();
  const claimedGameIds = new Set<string>();

  // sport: "mlb" everywhere here: only ever called from the MLB odds poll flow
  // (fetchMlbOdds) — tennis/soccer/NFL create their own Game rows instead.
  const eventDateById = new Map(events.map((e) => [e.id, etDateOf(new Date(e.commence_time))]));
  const cached = await prisma.game.findMany({
    where: { sport: "mlb", oddsApiEventId: { in: events.map((e) => e.id) } },
  });
  for (const game of cached) {
    const eventId = game.oddsApiEventId;
    if (!eventId) continue;
    // A cached binding is a shortcut, not an authority. Re-check it on the same
    // ET-day rule, so a binding made by the old first-match-wins code (or one
    // left on a rescheduled game) gets re-decided rather than persisting
    // forever — that's how a wrong match used to become permanent.
    if (eventDateById.get(eventId) !== etDateOf(game.scheduledStartUtc)) continue;
    matches.set(eventId, game);
    claimedGameIds.add(game.id);
  }

  const unresolved = events.filter((e) => !matches.has(e.id));
  if (!unresolved.length) return { matches, unmatched: [] };

  // Build every plausible (event, game) pairing, then let the best ones win.
  const pairs: { eventId: string; game: Game; deltaMs: number }[] = [];
  for (const event of unresolved) {
    const commenceTime = new Date(event.commence_time);
    const { gte, lt } = etDayBoundsUtc(etDateOf(commenceTime));

    const candidates = await prisma.game.findMany({
      where: {
        sport: "mlb",
        scheduledStartUtc: { gte, lt },
        // Feed names are reconciled to the schedule source's names first — see
        // teamNameAliases (MLB's "Athletics" vs the feed's "Oakland Athletics").
        homeTeam: { name: canonicalTeamName(event.home_team) },
        awayTeam: { name: canonicalTeamName(event.away_team) },
      },
    });

    for (const game of candidates) {
      pairs.push({
        eventId: event.id,
        game,
        // Only a tiebreak between two games of the same matchup on the same ET
        // day (a doubleheader). It is NOT a validity test — the provider's clock
        // is off by 6h on half the slate, so a large delta is normal, not wrong.
        deltaMs: Math.abs(game.scheduledStartUtc.getTime() - commenceTime.getTime()),
      });
    }
  }

  for (const { eventId, game } of resolveClosestPairings(pairs, claimedGameIds)) {
    matches.set(eventId, game);
    await prisma.game.update({ where: { id: game.id }, data: { oddsApiEventId: eventId } });
  }

  return { matches, unmatched: unresolved.filter((e) => !matches.has(e.id)) };
}

/**
 * Greedy one-to-one assignment: settle the tightest time agreement in the whole
 * poll first, so a doubleheader's two events land on their own two rows rather
 * than both piling onto whichever row happened to be listed first.
 *
 * Pure and exported for tests — this is the rule that keeps two games' prices
 * out of one board, so it's worth pinning down independently of the DB.
 */
export function resolveClosestPairings<G extends { id: string }>(
  pairs: { eventId: string; game: G; deltaMs: number }[],
  alreadyClaimedGameIds: ReadonlySet<string> = new Set()
): { eventId: string; game: G }[] {
  const claimedGames = new Set(alreadyClaimedGameIds);
  const takenEvents = new Set<string>();
  const assigned: { eventId: string; game: G }[] = [];

  // Sorted by closeness, then by ids purely so equal deltas resolve the same way
  // on every run — a tie shouldn't make the board non-deterministic.
  const ordered = [...pairs].sort(
    (a, b) => a.deltaMs - b.deltaMs || a.eventId.localeCompare(b.eventId) || a.game.id.localeCompare(b.game.id)
  );

  for (const { eventId, game } of ordered) {
    if (takenEvents.has(eventId) || claimedGames.has(game.id)) continue;
    takenEvents.add(eventId);
    claimedGames.add(game.id);
    assigned.push({ eventId, game });
  }
  return assigned;
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
  // Per-sport provider registry: MLB routes to OddsBlaze when opted in via
  // MLB_ODDS_PROVIDER=oddsblaze, else stays on the incumbent path below. The
  // OddsBlaze branch is a wholly separate function so the Parlay/TOA flow — and
  // its 6h-early ET-date matching — is untouched.
  if (oddsProviderForSport("mlb") === "oddsblaze") {
    return pollAndStoreOddsViaOddsBlaze();
  }

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

  const { matches, unmatched } = await assignEventsToGames(events);
  for (const event of unmatched) {
    gamesUnmatched.push(`${event.away_team} @ ${event.home_team} (${event.commence_time})`);
  }

  for (const event of events) {
    const game = matches.get(event.id);
    if (!game) continue;
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

  // ParlayAPI serves no alternate game lines at all: the endpoint rejects both
  // markets with INVALID_MARKET ("Valid values are: h2h, outrights, spreads,
  // totals, or any player_*/batter_*/pitcher_* prop market"), confirmed live
  // 2026-07-21. So this call has failed on EVERY poll since the provider switch,
  // logging a stack trace and returning nothing. Skipping it is the honest
  // behaviour — the alt-line ladder is a TOA capability we no longer have, and
  // pretending otherwise just buries a real error in the logs every run.
  //
  // Kept (rather than deleted) because it still works on TOA, which ODDS_PROVIDER
  // can select; delete it if TOA is retired for good.
  const altLineTargets =
    activeOddsProvider() === "parlay"
      ? []
      : upcomingMatches
          .sort((a, b) => a.minutesToStart - b.minutesToStart)
          .slice(0, MAX_ALT_LINE_GAMES_PER_POLL);

  for (const { event, game } of altLineTargets) {
    try {
      const altResult = await fetchEventAlternateOdds(event.id);
      snapshotsWritten += await storeBookmakerOdds(
        game.id,
        altResult.event.home_team,
        altResult.event.away_team,
        altResult.event.bookmakers,
        // Partial payload for a game whose main lines were written moments ago —
        // retiring "unrefreshed" rows here would delete exactly those.
        { retireStale: false }
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

/**
 * MLB odds via OddsBlaze — the MLB_ODDS_PROVIDER=oddsblaze path.
 *
 * Two things it does differently from the Parlay/TOA flow, both wins the provider
 * eval turned up:
 *
 *  1. Matches on mlbGameId. OddsBlaze carries the MLB Stats API gamePk on every
 *     event (mappings.MLB.id), so games join on a stable id — no ET-date +
 *     team-name reconciliation, no doubleheader-merge risk. This is why OddsBlaze
 *     surfaces tomorrow's slate the night before where Parlay lags: the whole
 *     matching problem assignEventsToGames exists to solve simply isn't here.
 *  2. Alt lines come free in the same fan-out. OddsBlaze returns the full ladder
 *     per book in one call, so there's no separate per-event alt fetch and no
 *     MAX_ALT_LINE_GAMES_PER_POLL cap — storeBookmakerOdds writes main + alts in
 *     one go, with retireStaleAlternates so withdrawn rungs don't linger.
 *
 * skipLive drops in-play games at the source; the start-time guard covers a game
 * that flips to started between fetch and write, same as the Parlay path.
 */
async function pollAndStoreOddsViaOddsBlaze(): Promise<PollOddsSummary> {
  const { events, creditsUsed, creditsRemaining } = await fetchOddsBlazeGameOdds("mlb", {
    skipLive: true,
  });
  const now = new Date();

  // Resolve every game by gamePk in one query, rather than per-event.
  const gamePks = events
    .map((e) => e.mlbGameId)
    .filter((pk): pk is number => typeof pk === "number");
  const games = gamePks.length
    ? await prisma.game.findMany({ where: { sport: "mlb", mlbGameId: { in: gamePks } } })
    : [];
  const gameByPk = new Map<number, Game>();
  for (const g of games) if (g.mlbGameId != null) gameByPk.set(g.mlbGameId, g);

  let gamesMatched = 0;
  let snapshotsWritten = 0;
  let altLineGamesPolled = 0;
  const gamesUnmatched: string[] = [];

  for (const event of events) {
    const game = event.mlbGameId != null ? gameByPk.get(event.mlbGameId) : undefined;
    if (!game) {
      // No scheduled Game row for this gamePk yet (schedule not synced), or the
      // event carried no MLB mapping — same "unmatched" bucket as the Parlay flow.
      gamesUnmatched.push(`${event.away_team} @ ${event.home_team} (${event.commence_time})`);
      continue;
    }
    gamesMatched++;

    // Never overwrite a shoppable pregame line with an in-play price.
    if (game.scheduledStartUtc.getTime() < now.getTime()) continue;

    const hasAlternates = event.bookmakers.some((b) =>
      b.markets.some((m) => m.key === "alternate_spreads" || m.key === "alternate_totals")
    );

    snapshotsWritten += await storeBookmakerOdds(
      game.id,
      event.home_team,
      event.away_team,
      event.bookmakers,
      // One payload = the whole picture (main + full alt ladder), so retire stale
      // rows on BOTH main and alt lines — see retireStaleAlternates in storeOdds.
      { retireStale: true, retireStaleAlternates: true }
    );
    if (hasAlternates) altLineGamesPolled++;
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
