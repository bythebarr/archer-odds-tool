/**
 * The NHL on the shared team-league pipeline (src/lib/teamLeague): odds from
 * `icehockey_nhl`, results from ESPN's free scoreboard, both resolved through
 * the 32-team allowlist. Mirrors src/lib/nba/league.ts exactly.
 */
import type { TeamLeague } from "@/lib/teamLeague/league";
import { pollAndStoreTeamLeagueOdds } from "@/lib/teamLeague/ingest";
import { lookupNhlTeam } from "./teams";

/**
 * The NHL season a date belongs to, named for the year it STARTS: the 2026-27
 * season opens in October 2026 and its Stanley Cup Final runs into June 2027,
 * all of it season 2026. Same Oct–Jun shape as the NBA: the boundary sits in
 * the dead months — after the June Final, before September's training camps —
 * so January to August belongs to the prior year's season.
 */
export function nhlSeasonOf(date: Date): number {
  const year = date.getUTCFullYear();
  // Months are 0-indexed: 0-7 = Jan-Aug, the tail of the prior season.
  return date.getUTCMonth() <= 7 ? year - 1 : year;
}

export const NHL_LEAGUE: TeamLeague = {
  sport: "nhl",
  label: "NHL",
  oddsSportKey: "icehockey_nhl",
  espnPath: "hockey/nhl",
  oddsJobName: "poll-odds-nhl",
  lookupTeam: lookupNhlTeam,
  seasonOf: nhlSeasonOf,
};

export function pollAndStoreNhlOdds() {
  return pollAndStoreTeamLeagueOdds(NHL_LEAGUE);
}
