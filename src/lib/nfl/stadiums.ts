/**
 * NFL stadium geography — the input Decision 11 needs and the database
 * never had (Game.venue is MLB-only). A static table, not a sync: stadiums
 * move on a decade scale, and a wrong-coordinate failure mode is benign —
 * the forecast is fetched for the home team's city either way, and a team
 * missing from this table simply gets no weather (the pre-Decision-11
 * neutral behavior).
 *
 * Roof classes follow the same rule the MLB weather model already uses:
 * weather applies only where the field is genuinely exposed. "retractable"
 * and "dome"/"covered" stadiums are never fetched at all, because whether a
 * retractable roof is open on game day is not knowable in advance from any
 * free source, and a covered field sees neither wind nor rain.
 */

export type NflRoof = "open" | "retractable" | "dome";

export interface NflStadium {
  latitude: number;
  longitude: number;
  roof: NflRoof;
}

/** Keyed by the team's stored abbreviation (ESPN codes, as synced). */
export const NFL_STADIUMS: Record<string, NflStadium> = {
  ARI: { latitude: 33.5276, longitude: -112.2626, roof: "retractable" }, // State Farm Stadium, Glendale
  ATL: { latitude: 33.7554, longitude: -84.4008, roof: "retractable" }, // Mercedes-Benz Stadium
  BAL: { latitude: 39.278, longitude: -76.6227, roof: "open" }, // M&T Bank Stadium
  BUF: { latitude: 42.7738, longitude: -78.787, roof: "open" }, // Highmark Stadium, Orchard Park
  CAR: { latitude: 35.2258, longitude: -80.8528, roof: "open" }, // Bank of America Stadium
  CHI: { latitude: 41.8623, longitude: -87.6167, roof: "open" }, // Soldier Field
  CIN: { latitude: 39.0954, longitude: -84.516, roof: "open" }, // Paycor Stadium
  CLE: { latitude: 41.5061, longitude: -81.6995, roof: "open" }, // Huntington Bank Field
  DAL: { latitude: 32.7473, longitude: -97.0945, roof: "retractable" }, // AT&T Stadium, Arlington
  DEN: { latitude: 39.7439, longitude: -105.0201, roof: "open" }, // Empower Field at Mile High
  DET: { latitude: 42.34, longitude: -83.0456, roof: "dome" }, // Ford Field
  GB: { latitude: 44.5013, longitude: -88.0522, roof: "open" }, // Lambeau Field
  HOU: { latitude: 29.6847, longitude: -95.4107, roof: "retractable" }, // NRG Stadium
  IND: { latitude: 39.7601, longitude: -86.1639, roof: "retractable" }, // Lucas Oil Stadium
  JAX: { latitude: 30.3239, longitude: -81.6373, roof: "open" }, // EverBank Stadium
  KC: { latitude: 39.0489, longitude: -94.4839, roof: "open" }, // Arrowhead Stadium
  LV: { latitude: 36.0909, longitude: -115.1833, roof: "dome" }, // Allegiant Stadium
  LAC: { latitude: 33.9535, longitude: -118.3392, roof: "dome" }, // SoFi Stadium (fixed canopy)
  LAR: { latitude: 33.9535, longitude: -118.3392, roof: "dome" }, // SoFi Stadium (fixed canopy)
  MIA: { latitude: 25.958, longitude: -80.2389, roof: "open" }, // Hard Rock Stadium
  MIN: { latitude: 44.9737, longitude: -93.2577, roof: "dome" }, // U.S. Bank Stadium
  NE: { latitude: 42.0909, longitude: -71.2643, roof: "open" }, // Gillette Stadium
  NO: { latitude: 29.9511, longitude: -90.0812, roof: "dome" }, // Caesars Superdome
  NYG: { latitude: 40.8135, longitude: -74.0745, roof: "open" }, // MetLife Stadium
  NYJ: { latitude: 40.8135, longitude: -74.0745, roof: "open" }, // MetLife Stadium
  PHI: { latitude: 39.9008, longitude: -75.1675, roof: "open" }, // Lincoln Financial Field
  PIT: { latitude: 40.4468, longitude: -79.9873, roof: "open" }, // Acrisure Stadium
  SF: { latitude: 37.403, longitude: -121.97, roof: "open" }, // Levi's Stadium
  SEA: { latitude: 47.5952, longitude: -122.3316, roof: "open" }, // Lumen Field
  TB: { latitude: 27.9759, longitude: -82.5033, roof: "open" }, // Raymond James Stadium
  TEN: { latitude: 36.1665, longitude: -86.7713, roof: "open" }, // Nissan Stadium
  WSH: { latitude: 38.9076, longitude: -76.8645, roof: "open" }, // Northwest Stadium, Landover
  // Alias under the other common abbreviation for Washington.
  WAS: { latitude: 38.9076, longitude: -76.8645, roof: "open" },
};

/** The stadium for a team abbreviation, or null when unknown (no weather). */
export function nflStadiumFor(teamAbbreviation: string | null | undefined): NflStadium | null {
  if (!teamAbbreviation) return null;
  return NFL_STADIUMS[teamAbbreviation.toUpperCase()] ?? null;
}
