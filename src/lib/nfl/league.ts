/**
 * The NFL on the shared team-league pipeline (src/lib/teamLeague): odds from
 * `americanfootball_nfl`, results from ESPN's free scoreboard, both resolved
 * through the 32-team allowlist that keeps the feed's CFL games out.
 * History and the reasoning behind each piece: docs/architecture/nfl-adapter.md.
 */
import type { TeamLeague } from "@/lib/teamLeague/league";
import { pollAndStoreTeamLeagueOdds } from "@/lib/teamLeague/ingest";
import { lookupNflTeam } from "./teams";

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

export const NFL_LEAGUE: TeamLeague = {
  sport: "nfl",
  label: "NFL",
  oddsSportKey: "americanfootball_nfl",
  espnPath: "football/nfl",
  oddsJobName: "poll-odds-nfl",
  lookupTeam: lookupNflTeam,
  seasonOf: nflSeasonOf,
};

export function pollAndStoreNflOdds() {
  return pollAndStoreTeamLeagueOdds(NFL_LEAGUE);
}
