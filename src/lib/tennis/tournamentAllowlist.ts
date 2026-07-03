/**
 * Operator-curated tennis tournament sport_keys — mirrors bookAllowlist.ts's
 * pattern. The Odds API organizes tennis per-tournament (not one evergreen
 * key like baseball_mlb), and each additional concurrently-polled key
 * doubles the credit cost per poll (see the tennis plan doc's credit
 * budget) — capped at one tour at a time, ATP preferred with a WTA
 * fallback (see tennis/ingest.ts's resolveActiveTennisSportKey).
 *
 * Update these by hand as tournaments change — confirmed live via
 * fetchSportsList() (free, no credit cost) before switching, per the tennis
 * plan doc's M0 verification step. As of 2026-07-03 both are active
 * (Wimbledon, June 29 - July 12, 2026).
 */
export const PREFERRED_TENNIS_SPORT_KEY = "tennis_atp_wimbledon";
export const FALLBACK_TENNIS_SPORT_KEY = "tennis_wta_wimbledon";
