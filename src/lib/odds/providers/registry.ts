/**
 * Per-sport odds-provider registry.
 *
 * Until now the provider was one global choice (activeOddsProvider in
 * oddsApiClient.ts): the whole app read from Parlay or TOA. That was fine when one
 * feed covered everything, but different providers have different strengths per
 * sport — OddsBlaze carries a stable MLB gamePk mapping and DFS/exchange depth
 * Parlay lacks, while Parlay stays the incumbent elsewhere. This registry lets a
 * sport pick its own provider without touching the others.
 *
 * Design intent — nothing flips by accident:
 *   • Default is the existing global provider, so with no env set, every sport
 *     behaves exactly as it does today. Parlay stays live.
 *   • A sport opts in with `<SPORT>_ODDS_PROVIDER=oddsblaze` (e.g.
 *     MLB_ODDS_PROVIDER=oddsblaze). Reversible by unsetting one var — same
 *     philosophy as ODDS_PROVIDER, deliberately not a deploy.
 *
 * This registry names the choice; it does not itself fetch. An ingest reads
 * `oddsProviderForSport(sport)` and calls the matching client (fetchOdds for
 * parlay/toa, fetchOddsBlazeGameOdds for oddsblaze) — both return the same
 * FetchOddsResult shape, so the write path downstream is identical.
 */
import type { Sport } from "@/generated/prisma/client";
import { activeOddsProvider } from "@/lib/odds/oddsApiClient";

export type OddsProviderId = "parlay" | "toa" | "oddsblaze";

/** Env var that overrides the provider for each sport. */
const ENV_VAR_BY_SPORT: Record<Sport, string> = {
  mlb: "MLB_ODDS_PROVIDER",
  nfl: "NFL_ODDS_PROVIDER",
  tennis: "TENNIS_ODDS_PROVIDER",
  soccer: "SOCCER_ODDS_PROVIDER",
  ufc: "UFC_ODDS_PROVIDER",
};

const VALID: readonly OddsProviderId[] = ["parlay", "toa", "oddsblaze"];

/**
 * Which provider serves game odds for a sport. Per-sport env override, else the
 * global default (today's behavior). An unrecognized override value is ignored
 * with a warning rather than silently swapping in a broken provider.
 */
export function oddsProviderForSport(sport: Sport): OddsProviderId {
  const raw = process.env[ENV_VAR_BY_SPORT[sport]]?.trim().toLowerCase();
  if (raw) {
    if ((VALID as readonly string[]).includes(raw)) return raw as OddsProviderId;
    console.warn(
      `${ENV_VAR_BY_SPORT[sport]}='${raw}' is not a known provider (${VALID.join("/")}); falling back to the global default`
    );
  }
  return activeOddsProvider();
}

/**
 * OddsBlaze league id for one of our sports. Sports with several OddsBlaze leagues
 * (tennis = atp/wta/challenger/…, soccer = a dozen competitions) return the list;
 * single-league sports return one. Used by an ingest to know what to request once
 * a sport is pointed at OddsBlaze.
 */
export function oddsBlazeLeaguesForSport(sport: Sport): string[] {
  switch (sport) {
    case "mlb":
      return ["mlb"];
    case "nfl":
      return ["nfl"];
    case "ufc":
      return ["ufc"];
    case "tennis":
      return ["atp", "wta", "challenger"];
    case "soccer":
      return [
        "england-premier-league",
        "spain-laliga",
        "italy-serie-a",
        "germany-bundesliga",
        "france-ligue-1",
        "uefa-champions-league",
        "usa-mls",
      ];
    default:
      return [];
  }
}
