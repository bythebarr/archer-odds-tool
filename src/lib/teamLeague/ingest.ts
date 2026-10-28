/**
 * Odds ingest for a team league (NFL, NBA) — phase 1 of the league adapters.
 *
 * Structurally MLB's poll, not tennis/soccer's: a team sport on the shared Game
 * table with spreads and totals as its spine. It follows soccer's *storage*
 * pattern though — teams are upserted by `oddsApiName`, because unlike MLB there
 * is no free authoritative team-id source; ESPN settles results by team name
 * (see results.ts).
 */
import { prisma } from "@/lib/prisma";
import { fetchOdds, type OddsApiEvent, type OddsApiMarketKey } from "@/lib/odds/oddsApiClient";
import { storeBookmakerOdds } from "@/lib/odds/storeOdds";
import type { LeagueTeamInfo, TeamLeague } from "./league";
import { findGameByTeamsOnDay } from "./schedule";
import { isPreseasonMatchup } from "./preseason";

/**
 * Spreads and totals are the spine of both leagues — the opposite weighting to
 * MLB, where the moneyline leads. h2h is still requested because it costs nothing
 * extra beyond its own market slot and the card prices it for underdogs.
 */
const TEAM_LEAGUE_MARKETS: OddsApiMarketKey[] = ["h2h", "spreads", "totals"];
/** Same US-legal-books-only regions as every other sport — see bookAllowlist.ts. */
const TEAM_LEAGUE_REGIONS = ["us", "us2"];

async function upsertTeam(team: LeagueTeamInfo, feedName: string) {
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
 * Finds or creates the Game row for an event.
 *
 * Matched on `oddsApiEventId` — safe HERE, and only here, because this is a
 * single-endpoint write: the id we store is the same id we just read from
 * /odds, never one joined across endpoints. The audit's warning
 * (provider-coverage.md: NFL ids agreed on only 12 of 16 between /odds and
 * /scores) applies to the results join, which is why results match on team
 * names instead.
 */
async function upsertGameForEvent(
  league: TeamLeague,
  event: OddsApiEvent,
  home: LeagueTeamInfo,
  away: LeagueTeamInfo
) {
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id, sport: league.sport } });
  if (existing) return existing;

  // A game the schedule sync (ESPN) already created: adopt it rather than add a
  // second row for the same matchup. Only an unclaimed row — one already bound to
  // a different event id is a different game (a doubleheader-style rematch).
  const startUtc = new Date(event.commence_time);
  const scheduled = await findGameByTeamsOnDay(league, home, away, startUtc);
  if (scheduled && !scheduled.oddsApiEventId) {
    return prisma.game.update({ where: { id: scheduled.id }, data: { oddsApiEventId: event.id, scheduledStartUtc: startUtc } });
  }

  // Books hang preseason lines; we don't carry exhibitions (see preseason.ts).
  if (await isPreseasonMatchup(league, home, away, startUtc)) return null;

  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(home, event.home_team),
    upsertTeam(away, event.away_team),
  ]);

  return prisma.game.create({
    data: {
      sport: league.sport,
      oddsApiEventId: event.id,
      season: league.seasonOf(new Date(event.commence_time)),
      scheduledStartUtc: new Date(event.commence_time),
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
    },
  });
}

export interface PollTeamLeagueOddsSummary {
  sportKeyPolled: string;
  eventsFetched: number;
  gamesStored: number;
  snapshotsWritten: number;
  /** Events dropped because a competitor isn't on the league's allowlist (CFL under the NFL key, WNBA under the NBA key). */
  eventsSkippedUnknownTeam: number;
  /** The actual unrecognized names, so team-name drift is debuggable from the log. */
  skippedTeamNames: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches a league's current odds and archives them via the shared
 * storeBookmakerOdds write path (unchanged from MLB/tennis/soccer).
 *
 * Credit budget: 3 markets x 2 regions = 6 credits/call — the same shape MLB's
 * poll already runs at. Cadence lives in each league's cron route.
 */
export async function pollAndStoreTeamLeagueOdds(league: TeamLeague): Promise<PollTeamLeagueOddsSummary> {
  const { events, creditsUsed, creditsRemaining } = await fetchOdds(
    league.oddsSportKey,
    TEAM_LEAGUE_MARKETS,
    TEAM_LEAGUE_REGIONS
  );

  let gamesStored = 0;
  let snapshotsWritten = 0;
  let eventsSkippedUnknownTeam = 0;
  const skippedTeamNames = new Set<string>();
  const now = new Date();

  for (const event of events) {
    // Same rule as every other sport: skip games already underway — a live price
    // reflects game state, not a shoppable pregame number.
    if (new Date(event.commence_time).getTime() < now.getTime()) continue;

    // The other-league filter. The feed genuinely serves CFL games under the NFL
    // key, and only a known-team check separates them; see league.ts.
    const home = league.lookupTeam(event.home_team);
    const away = league.lookupTeam(event.away_team);
    if (!home || !away) {
      if (!home) skippedTeamNames.add(event.home_team);
      if (!away) skippedTeamNames.add(event.away_team);
      eventsSkippedUnknownTeam++;
      continue;
    }

    const game = await upsertGameForEvent(league, event, home, away);
    if (!game) continue; // a preseason exhibition
    gamesStored++;
    snapshotsWritten += await storeBookmakerOdds(game.id, event.home_team, event.away_team, event.bookmakers);
  }

  if (skippedTeamNames.size) {
    // Loud, because this line has two very different meanings: another league's
    // clubs (expected), or a real team whose name drifted past the allowlist —
    // which would silently cost us games. The names make it a one-look diagnosis.
    console.log(
      `${league.oddsJobName}: skipped non-${league.label} competitors — ${[...skippedTeamNames].sort().join(", ")}`
    );
  }

  return {
    sportKeyPolled: league.oddsSportKey,
    eventsFetched: events.length,
    gamesStored,
    snapshotsWritten,
    eventsSkippedUnknownTeam,
    skippedTeamNames: [...skippedTeamNames].sort(),
    creditsUsed,
    creditsRemaining,
  };
}
