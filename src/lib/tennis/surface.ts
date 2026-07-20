/**
 * Court surface for a polled tennis tournament. The Odds API organizes tennis by
 * per-tournament sport_key (e.g. "tennis_atp_wimbledon"), which implies the surface
 * but never states it — so we map the tournaments we actually poll to a surface at
 * ingest, persisting it on the Game for the surface-aware Elo model to price on.
 *
 * Conservative by design: an UNKNOWN tournament returns null (the model then prices
 * on overall Elo — safe) rather than guessing a surface, which would misapply a
 * player's surface rating. Extend the map as tournaments are added to the allowlist.
 */

/** Substring → surface. First match wins; order the specific before the generic. */
const SURFACE_BY_KEYWORD: [string, string][] = [
  // Grass
  ["wimbledon", "Grass"],
  ["queens", "Grass"],
  ["halle", "Grass"],
  ["eastbourne", "Grass"],
  ["hertogenbosch", "Grass"],
  ["stuttgart_atp", "Grass"], // Stuttgart's ATP grass leg
  ["newport", "Grass"],
  // Clay
  ["roland_garros", "Clay"],
  ["french", "Clay"],
  ["monte_carlo", "Clay"],
  ["madrid", "Clay"],
  ["rome", "Clay"],
  ["hamburg", "Clay"],
  ["barcelona", "Clay"],
  ["estoril", "Clay"],
  ["munich", "Clay"],
  ["kitzbuhel", "Clay"],
  ["bastad", "Clay"],
  ["gstaad", "Clay"],
  // Hard (incl. the two hard-court slams)
  ["australian_open", "Hard"],
  ["us_open", "Hard"],
  ["indian_wells", "Hard"],
  ["miami", "Hard"],
  ["cincinnati", "Hard"],
  ["canadian", "Hard"],
  ["shanghai", "Hard"],
  ["dubai", "Hard"],
  ["acapulco", "Hard"],
];

/** Derive the court surface from a polled tournament sport_key, or null if unknown. */
export function surfaceForSportKey(sportKey: string | null | undefined): string | null {
  if (!sportKey) return null;
  const k = sportKey.toLowerCase();
  for (const [kw, surface] of SURFACE_BY_KEYWORD) {
    if (k.includes(kw)) return surface;
  }
  return null;
}
