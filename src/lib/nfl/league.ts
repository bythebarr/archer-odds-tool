/**
 * NFL odds ingest — phase 1 of docs/architecture/nfl-adapter.md ("feed only").
 *
 * Structurally MLB's poll, not tennis/soccer's: NFL is a team sport on the shared
 * Game table with spreads and totals as its spine. It follows soccer's *storage*
 * pattern though — teams are upserted by `oddsApiName`, because unlike MLB there
 * is no free authoritative id source wired up yet (the doc's candidate is ESPN's
 * public scoreboard; that's phase 1's results half and isn't built here).
 *
 * Consequence worth stating plainly: without a results source, NFL is another
 * `signalOnly` sport for now — priced, shoppable, not graded. The Game rows this
 * writes are what a results feed will later settle, so nothing here needs redoing
 * when it lands; see the adapter.
 */
import { prisma } from "@/lib/prisma";
import { fetchOdds, type OddsApiEvent, type OddsApiMarketKey } from "@/lib/odds/oddsApiClient";
import { storeBookmakerOdds } from "@/lib/odds/storeOdds";
import { lookupNflTeam, type NflTeamInfo } from "./teams";

export const NFL_SPORT_KEY = "americanfootball_nfl";

/**
 * NFL's spine is spreads and totals — the opposite weighting to MLB, where the
 * moneyline leads. h2h is still requested because it costs nothing extra beyond
 * its own market slot and the card prices it for underdogs.
 */
const NFL_MARKETS: OddsApiMarketKey[] = ["h2h", "spreads", "totals"];
/** Same US-legal-books-only regions as every other sport — see bookAllowlist.ts. */
const NFL_REGIONS = ["us", "us2"];

async function upsertTeam(team: NflTeamInfo, feedName: string) {
  return prisma.team.upsert({
    where: { oddsApiName: feedName },
    create: {
      name: team.name,
      oddsApiName: feedName,
      abbreviation: team.abbreviation,
      // Real values, not placeholders: the allowlist we already need for filtering
      // carries conference and division, so there's nothing left to synthesize.
      league: team.conference,
      division: team.division,
    },
    // Self-healing rather than `update: {}` (soccer's pattern): these values come
    // from our own allowlist, not the feed, so rewriting them each poll costs one
    // no-op write and means a corrected table entry propagates on the next run
    // instead of needing a migration.
    update: {
      name: team.name,
      abbreviation: team.abbreviation,
      league: team.conference,
      division: team.division,
    },
  });
}

/**
 * Finds or creates the Game row for an NFL event.
 *
 * Matched on `oddsApiEventId` — safe HERE, and only here, because this is a
 * single-endpoint write: the id we store is the same id we just read from
 * /odds, never one joined across endpoints. The audit's warning
 * (provider-coverage.md: NFL ids agreed on only 12 of 16 between /odds and
 * /scores) applies to the results join, which is why the doc says to match
 * results on team names instead when that lands.
 */
async function upsertGameForEvent(event: OddsApiEvent, home: NflTeamInfo, away: NflTeamInfo) {
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id, sport: "nfl" } });
  if (existing) return existing;

  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(home, event.home_team),
    upsertTeam(away, event.away_team),
  ]);

  return prisma.game.create({
    data: {
      sport: "nfl",
      oddsApiEventId: event.id,
      season: nflSeasonOf(new Date(event.commence_time)),
      scheduledStartUtc: new Date(event.commence_time),
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
    },
  });
}

/**
 * The NFL season a date belongs to. A season is named for the year it STARTS, so
 * January and February games belong to the previous year's season — the Super Bowl
 * in Feb 2027 is the 2026 season. Using the calendar year (as MLB and soccer safely
 * do) would split every season across two `season` values right at the playoffs.
 */
export function nflSeasonOf(date: Date): number {
  const year = date.getUTCFullYear();
  // Months are 0-indexed: 0-2 = Jan-Mar, the tail of the prior season.
  return date.getUTCMonth() <= 2 ? year - 1 : year;
}

export interface PollNflOddsSummary {
  sportKeyPolled: string;
  eventsFetched: number;
  gamesStored: number;
  snapshotsWritten: number;
  /** Events dropped because a competitor isn't one of the 32 NFL teams (CFL, mostly). */
  eventsSkippedNotNfl: number;
  /** The actual unrecognized names, so team-name drift is debuggable from the log. */
  skippedTeamNames: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current NFL odds and archives them via the shared storeBookmakerOdds
 * write path (unchanged from MLB/tennis/soccer).
 *
 * Credit budget: 3 markets x 2 regions = 6 credits/call — the same shape MLB's
 * twice-daily poll already runs at, so this is a known cost, not a new class of
 * spend. Cadence lives in the cron route, deliberately on the conservative
 * fixed-interval policy rather than MLB's tiered near-kickoff throttle: it's July,
 * and per the coverage doc NFL book depth can't be judged until preseason.
 */
export async function pollAndStoreNflOdds(): Promise<PollNflOddsSummary> {
  const { events, creditsUsed, creditsRemaining } = await fetchOdds(NFL_SPORT_KEY, NFL_MARKETS, NFL_REGIONS);

  let gamesStored = 0;
  let snapshotsWritten = 0;
  let eventsSkippedNotNfl = 0;
  const skippedTeamNames = new Set<string>();
  const now = new Date();

  for (const event of events) {
    // Same rule as every other sport: skip games already underway — a live price
    // reflects game state, not a shoppable pregame number.
    if (new Date(event.commence_time).getTime() < now.getTime()) continue;

    // The CFL filter. See teams.ts: this feed genuinely serves Canadian football
    // under the NFL sport key, and only a known-team check separates them.
    const home = lookupNflTeam(event.home_team);
    const away = lookupNflTeam(event.away_team);
    if (!home || !away) {
      if (!home) skippedTeamNames.add(event.home_team);
      if (!away) skippedTeamNames.add(event.away_team);
      eventsSkippedNotNfl++;
      continue;
    }

    const game = await upsertGameForEvent(event, home, away);
    gamesStored++;
    snapshotsWritten += await storeBookmakerOdds(game.id, event.home_team, event.away_team, event.bookmakers);
  }

  if (skippedTeamNames.size) {
    // Loud, because this line has two very different meanings: the expected CFL
    // clubs, or a real NFL team whose name drifted past the allowlist — which
    // would silently cost us games. The names make it a one-look diagnosis.
    console.log(`poll-odds-nfl: skipped non-NFL competitors — ${[...skippedTeamNames].sort().join(", ")}`);
  }

  return {
    sportKeyPolled: NFL_SPORT_KEY,
    eventsFetched: events.length,
    gamesStored,
    snapshotsWritten,
    eventsSkippedNotNfl,
    skippedTeamNames: [...skippedTeamNames].sort(),
    creditsUsed,
    creditsRemaining,
  };
}
