/**
 * The 32 NFL teams, as the ingest's allowlist AND its source of real
 * abbreviation / conference / division values.
 *
 * This exists because of a live data bug, not out of tidiness: ParlayAPI's
 * `americanfootball_nfl` key also returns **CFL** games (measured 2026-07-21 —
 * Edmonton Elks, Saskatchewan Roughriders, Calgary Stampeders, Winnipeg Blue
 * Bombers, Toronto Argonauts, BC Lions, Hamilton Tiger-Cats, Montreal
 * Alouettes). Canadian football is a different sport with different scoring, so
 * those rows would corrupt any NFL model or record they reached. Matching on a
 * closed set of known team names is the only reliable filter — the feed's own
 * sport key does not distinguish them.
 *
 * A 32-row constant is normally the kind of thing that rots, which is why it was
 * avoided at first. It's justified here because the set is genuinely stable (one
 * rename since 2016: Washington in 2020, one relocation: the 2020 Raiders), and
 * because the alternative is storing another league's games as NFL.
 */
import { createTeamLookup, type LeagueTeamInfo } from "@/lib/teamLeague/league";

export interface NflTeamInfo extends LeagueTeamInfo {
  conference: "AFC" | "NFC";
  division: "East" | "North" | "South" | "West";
}

export const NFL_TEAMS: NflTeamInfo[] = [
  { name: "Buffalo Bills", abbreviation: "BUF", conference: "AFC", division: "East" },
  { name: "Miami Dolphins", abbreviation: "MIA", conference: "AFC", division: "East" },
  { name: "New England Patriots", abbreviation: "NE", conference: "AFC", division: "East" },
  { name: "New York Jets", abbreviation: "NYJ", conference: "AFC", division: "East" },
  { name: "Baltimore Ravens", abbreviation: "BAL", conference: "AFC", division: "North" },
  { name: "Cincinnati Bengals", abbreviation: "CIN", conference: "AFC", division: "North" },
  { name: "Cleveland Browns", abbreviation: "CLE", conference: "AFC", division: "North" },
  { name: "Pittsburgh Steelers", abbreviation: "PIT", conference: "AFC", division: "North" },
  { name: "Houston Texans", abbreviation: "HOU", conference: "AFC", division: "South" },
  { name: "Indianapolis Colts", abbreviation: "IND", conference: "AFC", division: "South" },
  { name: "Jacksonville Jaguars", abbreviation: "JAX", conference: "AFC", division: "South" },
  { name: "Tennessee Titans", abbreviation: "TEN", conference: "AFC", division: "South" },
  { name: "Denver Broncos", abbreviation: "DEN", conference: "AFC", division: "West" },
  { name: "Kansas City Chiefs", abbreviation: "KC", conference: "AFC", division: "West" },
  { name: "Las Vegas Raiders", abbreviation: "LV", conference: "AFC", division: "West" },
  { name: "Los Angeles Chargers", abbreviation: "LAC", conference: "AFC", division: "West" },
  { name: "Dallas Cowboys", abbreviation: "DAL", conference: "NFC", division: "East" },
  { name: "New York Giants", abbreviation: "NYG", conference: "NFC", division: "East" },
  { name: "Philadelphia Eagles", abbreviation: "PHI", conference: "NFC", division: "East" },
  { name: "Washington Commanders", abbreviation: "WAS", conference: "NFC", division: "East" },
  { name: "Chicago Bears", abbreviation: "CHI", conference: "NFC", division: "North" },
  { name: "Detroit Lions", abbreviation: "DET", conference: "NFC", division: "North" },
  { name: "Green Bay Packers", abbreviation: "GB", conference: "NFC", division: "North" },
  { name: "Minnesota Vikings", abbreviation: "MIN", conference: "NFC", division: "North" },
  { name: "Atlanta Falcons", abbreviation: "ATL", conference: "NFC", division: "South" },
  { name: "Carolina Panthers", abbreviation: "CAR", conference: "NFC", division: "South" },
  { name: "New Orleans Saints", abbreviation: "NO", conference: "NFC", division: "South" },
  { name: "Tampa Bay Buccaneers", abbreviation: "TB", conference: "NFC", division: "South" },
  { name: "Arizona Cardinals", abbreviation: "ARI", conference: "NFC", division: "West" },
  { name: "Los Angeles Rams", abbreviation: "LAR", conference: "NFC", division: "West" },
  { name: "San Francisco 49ers", abbreviation: "SF", conference: "NFC", division: "West" },
  { name: "Seattle Seahawks", abbreviation: "SEA", conference: "NFC", division: "West" },
];

/** The NFL team this feed name refers to, or null if it isn't one of the 32 (e.g. a CFL club). */
export const lookupNflTeam = createTeamLookup(NFL_TEAMS);
