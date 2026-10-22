/**
 * The 30 NBA teams, as the ingest's allowlist AND its source of real
 * abbreviation / conference / division values — the same role NFL_TEAMS plays
 * for football, for the same reason.
 *
 * The odds feed's sport key is not a league filter: the 2026-07-21 coverage
 * audit counted 9–13 `basketball_nba` events in mid-July, when the NBA plays no
 * games at all (see docs/architecture/provider-coverage.md), and the NFL key was
 * found serving CFL games outright. Matching on a closed set of team names is
 * what keeps WNBA, Summer League, and preseason exhibitions against
 * international clubs from being stored and graded as NBA games.
 *
 * Aliases cover the one spelling split we know of between sources: ESPN renders
 * the Clippers as "LA Clippers" while books say "Los Angeles Clippers". Without
 * it every Clippers game would price but never grade.
 */
import { createTeamLookup, type LeagueTeamInfo } from "@/lib/teamLeague/league";

export interface NbaTeamInfo extends LeagueTeamInfo {
  conference: "East" | "West";
  division: "Atlantic" | "Central" | "Southeast" | "Northwest" | "Pacific" | "Southwest";
}

export const NBA_TEAMS: NbaTeamInfo[] = [
  { name: "Boston Celtics", abbreviation: "BOS", conference: "East", division: "Atlantic" },
  { name: "Brooklyn Nets", abbreviation: "BKN", conference: "East", division: "Atlantic" },
  { name: "New York Knicks", abbreviation: "NYK", conference: "East", division: "Atlantic" },
  { name: "Philadelphia 76ers", abbreviation: "PHI", conference: "East", division: "Atlantic" },
  { name: "Toronto Raptors", abbreviation: "TOR", conference: "East", division: "Atlantic" },
  { name: "Chicago Bulls", abbreviation: "CHI", conference: "East", division: "Central" },
  { name: "Cleveland Cavaliers", abbreviation: "CLE", conference: "East", division: "Central" },
  { name: "Detroit Pistons", abbreviation: "DET", conference: "East", division: "Central" },
  { name: "Indiana Pacers", abbreviation: "IND", conference: "East", division: "Central" },
  { name: "Milwaukee Bucks", abbreviation: "MIL", conference: "East", division: "Central" },
  { name: "Atlanta Hawks", abbreviation: "ATL", conference: "East", division: "Southeast" },
  { name: "Charlotte Hornets", abbreviation: "CHA", conference: "East", division: "Southeast" },
  { name: "Miami Heat", abbreviation: "MIA", conference: "East", division: "Southeast" },
  { name: "Orlando Magic", abbreviation: "ORL", conference: "East", division: "Southeast" },
  { name: "Washington Wizards", abbreviation: "WAS", conference: "East", division: "Southeast" },
  { name: "Denver Nuggets", abbreviation: "DEN", conference: "West", division: "Northwest" },
  { name: "Minnesota Timberwolves", abbreviation: "MIN", conference: "West", division: "Northwest" },
  { name: "Oklahoma City Thunder", abbreviation: "OKC", conference: "West", division: "Northwest" },
  { name: "Portland Trail Blazers", abbreviation: "POR", conference: "West", division: "Northwest" },
  { name: "Utah Jazz", abbreviation: "UTA", conference: "West", division: "Northwest" },
  { name: "Golden State Warriors", abbreviation: "GSW", conference: "West", division: "Pacific" },
  {
    name: "Los Angeles Clippers",
    abbreviation: "LAC",
    conference: "West",
    division: "Pacific",
    aliases: ["LA Clippers"],
  },
  { name: "Los Angeles Lakers", abbreviation: "LAL", conference: "West", division: "Pacific" },
  { name: "Phoenix Suns", abbreviation: "PHX", conference: "West", division: "Pacific" },
  { name: "Sacramento Kings", abbreviation: "SAC", conference: "West", division: "Pacific" },
  { name: "Dallas Mavericks", abbreviation: "DAL", conference: "West", division: "Southwest" },
  { name: "Houston Rockets", abbreviation: "HOU", conference: "West", division: "Southwest" },
  { name: "Memphis Grizzlies", abbreviation: "MEM", conference: "West", division: "Southwest" },
  { name: "New Orleans Pelicans", abbreviation: "NOP", conference: "West", division: "Southwest" },
  { name: "San Antonio Spurs", abbreviation: "SAS", conference: "West", division: "Southwest" },
];

/** The NBA team this feed name refers to, or null if it isn't one of the 30 (WNBA, an exhibition club, …). */
export const lookupNbaTeam = createTeamLookup(NBA_TEAMS);
