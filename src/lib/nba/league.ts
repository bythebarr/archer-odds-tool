/**
 * The NBA on the shared team-league pipeline (src/lib/teamLeague): odds from
 * `basketball_nba`, results from ESPN's free scoreboard, both resolved through
 * the 30-team allowlist. See docs/architecture/nba-adapter.md.
 */
import type { TeamLeague } from "@/lib/teamLeague/league";
import { pollAndStoreTeamLeagueOdds } from "@/lib/teamLeague/ingest";
import { lookupNbaTeam } from "./teams";

/**
 * The NBA season a date belongs to, named for the year it STARTS: the 2026-27
 * season tips off in October 2026 and its Finals run into June 2027, all of it
 * season 2026. The boundary sits in the dead months — after the June Finals and
 * the July Summer League, before September's training camps — so January to
 * August belongs to the prior year's season.
 */
export function nbaSeasonOf(date: Date): number {
  const year = date.getUTCFullYear();
  // Months are 0-indexed: 0-7 = Jan-Aug, the tail of the prior season.
  return date.getUTCMonth() <= 7 ? year - 1 : year;
}

export const NBA_LEAGUE: TeamLeague = {
  sport: "nba",
  label: "NBA",
  oddsSportKey: "basketball_nba",
  espnPath: "basketball/nba",
  oddsJobName: "poll-odds-nba",
  lookupTeam: lookupNbaTeam,
  seasonOf: nbaSeasonOf,
};

export function pollAndStoreNbaOdds() {
  return pollAndStoreTeamLeagueOdds(NBA_LEAGUE);
}
