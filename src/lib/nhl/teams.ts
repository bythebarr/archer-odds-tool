import { createTeamLookup, type LeagueTeamInfo } from "../teamLeague/league";

/**
 * The NHL allowlist (32 teams). Any other club arriving under the
 * `icehockey_nhl` sport key — AHL call-up exhibitions, international sides in
 * preseason, KHL clubs — is not an NHL team and must not allocate NHL prices.
 * Same stance as the NBA/NFL allowlists: game rows only ever come from this
 * list, and a name that matches nothing makes the poller drop the event.
 *
 * Data verified 2026-11-09 against ESPN's league directory (site.api.espn.com
 * hockey/nhl teams listing): 32 clubs, 2025–26 alignment — East = Atlantic +
 * Metropolitan, West = Central + Pacific, four per division.
 */
export interface NhlTeamInfo extends LeagueTeamInfo {
  conference: "East" | "West";
  division: "Atlantic" | "Metropolitan" | "Central" | "Pacific";
}

const EAST = "East" as const;
const WEST = "West" as const;
const ATLANTIC = "Atlantic" as const;
const METROPOLITAN = "Metropolitan" as const;
const CENTRAL = "Central" as const;
const PACIFIC = "Pacific" as const;

export const NHL_TEAMS: NhlTeamInfo[] = [
  // Eastern Conference — Atlantic
  { name: "Boston Bruins", abbreviation: "BOS", conference: EAST, division: ATLANTIC },
  { name: "Buffalo Sabres", abbreviation: "BUF", conference: EAST, division: ATLANTIC },
  { name: "Detroit Red Wings", abbreviation: "DET", conference: EAST, division: ATLANTIC },
  { name: "Florida Panthers", abbreviation: "FLA", conference: EAST, division: ATLANTIC },
  { name: "Montreal Canadiens", abbreviation: "MTL", conference: EAST, division: ATLANTIC },
  { name: "Ottawa Senators", abbreviation: "OTT", conference: EAST, division: ATLANTIC },
  { name: "Tampa Bay Lightning", abbreviation: "TB", conference: EAST, division: ATLANTIC },
  { name: "Toronto Maple Leafs", abbreviation: "TOR", conference: EAST, division: ATLANTIC },

  // Eastern Conference — Metropolitan
  { name: "Carolina Hurricanes", abbreviation: "CAR", conference: EAST, division: METROPOLITAN },
  { name: "Columbus Blue Jackets", abbreviation: "CBJ", conference: EAST, division: METROPOLITAN },
  { name: "New Jersey Devils", abbreviation: "NJD", conference: EAST, division: METROPOLITAN },
  { name: "New York Islanders", abbreviation: "NYI", conference: EAST, division: METROPOLITAN },
  { name: "New York Rangers", abbreviation: "NYR", conference: EAST, division: METROPOLITAN },
  { name: "Philadelphia Flyers", abbreviation: "PHI", conference: EAST, division: METROPOLITAN },
  { name: "Pittsburgh Penguins", abbreviation: "PIT", conference: EAST, division: METROPOLITAN },
  { name: "Washington Capitals", abbreviation: "WSH", conference: EAST, division: METROPOLITAN },

  // Western Conference — Central
  { name: "Chicago Blackhawks", abbreviation: "CHI", conference: WEST, division: CENTRAL },
  { name: "Colorado Avalanche", abbreviation: "COL", conference: WEST, division: CENTRAL },
  { name: "Dallas Stars", abbreviation: "DAL", conference: WEST, division: CENTRAL },
  { name: "Minnesota Wild", abbreviation: "MIN", conference: WEST, division: CENTRAL },
  { name: "Nashville Predators", abbreviation: "NSH", conference: WEST, division: CENTRAL },
  { name: "St. Louis Blues", abbreviation: "STL", conference: WEST, division: CENTRAL },
  // Renamed from the Utah Hockey Club for 2025–26. Feeds lag renames, so the
  // old name stays as an alias — the exact-name/no-fuzzy stance that makes
  // feed drift visible instead of silent.
  { name: "Utah Mammoth", abbreviation: "UTA", conference: WEST, division: CENTRAL, aliases: ["Utah Hockey Club"] },
  { name: "Winnipeg Jets", abbreviation: "WPG", conference: WEST, division: CENTRAL },

  // Western Conference — Pacific
  { name: "Anaheim Ducks", abbreviation: "ANA", conference: WEST, division: PACIFIC },
  { name: "Calgary Flames", abbreviation: "CGY", conference: WEST, division: PACIFIC },
  { name: "Edmonton Oilers", abbreviation: "EDM", conference: WEST, division: PACIFIC },
  { name: "Los Angeles Kings", abbreviation: "LAK", conference: WEST, division: PACIFIC },
  { name: "San Jose Sharks", abbreviation: "SJS", conference: WEST, division: PACIFIC },
  { name: "Seattle Kraken", abbreviation: "SEA", conference: WEST, division: PACIFIC },
  { name: "Vancouver Canucks", abbreviation: "VAN", conference: WEST, division: PACIFIC },
  { name: "Vegas Golden Knights", abbreviation: "VGK", conference: WEST, division: PACIFIC },
];

/** Exact-name (plus listed-alias) lookup; null for anything that is not an NHL club. */
export const lookupNhlTeam = createTeamLookup(NHL_TEAMS);
