/**
 * Operator-curated soccer sport_key — mirrors tennis/tournamentAllowlist.ts's
 * pattern. Deliberately scoped to the FIFA World Cup only (not every soccer
 * league The Odds API offers) to keep credit cost bounded and content timely
 * — see soccer/ingest.ts's credit budget note. Confirmed active via
 * fetchSportsList() (free, no credit cost) as of 2026-07-06 (World Cup 2026
 * runs June 11 - July 19, 2026). Update by hand once the tournament ends.
 */
export const WORLD_CUP_SPORT_KEY = "soccer_fifa_world_cup";
