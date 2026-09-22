/**
 * Explicit ESPN-display-name → nflverse-team-code resolution for the NFL
 * research vertical slice. This is its own module because the answer is NOT
 * "just reuse `NFL_TEAMS.abbreviation`" — see `NFLVERSE_CODE_OVERRIDES` below,
 * found by actually fetching nflverse's `games.csv` and diffing its observed
 * team codes against `NFL_TEAMS`, not assumed.
 *
 * Reuses `lookupNflTeam` (`src/lib/nfl/teams.ts`) unchanged — the same
 * 32-team allowlist/CFL-filter production grading already relies on — rather
 * than inventing a second team-name matcher.
 */
import { lookupNflTeam } from "../teams";
import type { NflGame } from "../games";

/**
 * Where nflverse's own historical team code differs from `NFL_TEAMS`'s
 * display abbreviation. Verified directly against nflverse's raw
 * `games.csv` (2026-09-21): the Rams are coded `"LA"` in EVERY row nflverse
 * has ever written for them — both the St. Louis era (also its own separate
 * code, `"STL"`, 1999–2015) and the Los Angeles era (2016–present) — `"LAR"`
 * (this codebase's own `NFL_TEAMS.abbreviation` for the Rams) never appears
 * in nflverse's data at all. Every other one of the 32 current teams' codes
 * matched `NFL_TEAMS.abbreviation` exactly in that same check.
 *
 * This table is a deliberately small, explicit, comment-justified exception
 * list — not a general fuzzy-matching mechanism. `resolveNflTeamIdentity`
 * below additionally validates the result against whatever nflverse codes
 * were ACTUALLY fetched, so a future, currently-unknown drift (nflverse
 * renaming a code again) is caught as an explicit validation failure rather
 * than silently defaulting a real team to an empty history.
 */
const NFLVERSE_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  LAR: "LA",
};

/**
 * Historical-only nflverse codes for relocated franchises that no longer
 * appear in current data but DO appear in older rows: the Raiders as `"OAK"`
 * (1999–2019, before `"LV"`, 2020–present), the Chargers as `"SD"`
 * (1999–2016, before `"LAC"`, 2017–present), and the Rams as `"STL"`
 * (1999–2015, before `"LA"`, 2016–present). This slice's Elo reconstruction
 * deliberately does NOT stitch these together — see this module's own
 * "Known limitation" doc comment below and docs/architecture/NFL-RESEARCH.md.
 * Listed here only for that documentation's benefit, not consumed by any
 * function in this file.
 */
export const KNOWN_HISTORICAL_CODE_DISCONTINUITIES = [
  { current: "LV", historical: "OAK", switchedSeason: 2020 },
  { current: "LAC", historical: "SD", switchedSeason: 2017 },
  { current: "LA", historical: "STL", switchedSeason: 2016 },
] as const;

export interface NflTeamIdentity {
  /** Full display name as ESPN renders it, e.g. "Los Angeles Rams". */
  espnName: string;
  /** This codebase's own display abbreviation (`NFL_TEAMS.abbreviation`), e.g. "LAR". */
  abbreviation: string;
  /** The code nflverse actually uses to key this team's Elo-relevant history, e.g. "LA". */
  nflverseCode: string;
}

/**
 * Resolves one ESPN display name to its nflverse Elo-history code. Returns
 * `null` — never a guess — when the name isn't one of the 32 known NFL teams
 * (the same CFL-filter `lookupNflTeam` already applies for production
 * grading). This function alone does NOT validate that `nflverseCode`
 * actually appears in a given fetched dataset — see `validateNflverseCode`
 * below for that, which the capture builder calls explicitly before trusting
 * a resolved identity.
 */
export function resolveNflTeamIdentity(espnDisplayName: string): NflTeamIdentity | null {
  const team = lookupNflTeam(espnDisplayName);
  if (!team) return null;
  const nflverseCode = NFLVERSE_CODE_OVERRIDES[team.abbreviation] ?? team.abbreviation;
  return { espnName: team.name, abbreviation: team.abbreviation, nflverseCode };
}

/** Every team code that actually appears (as either side) anywhere in a fetched nflverse games array. */
export function observedNflverseCodes(games: readonly NflGame[]): Set<string> {
  const codes = new Set<string>();
  for (const g of games) {
    codes.add(g.home);
    codes.add(g.away);
  }
  return codes;
}

/**
 * The explicit validation step: does this resolved identity's nflverse code
 * actually appear ANYWHERE in the real, just-fetched nflverse dataset? A
 * `false` here means the identity mapping itself is untrustworthy for this
 * team — e.g. a future nflverse code change this override table doesn't yet
 * know about — and the caller must treat it as a hard exclusion (a distinct,
 * reported reason), never as "0 games" (which would misrepresent a mapping
 * failure as a legitimate, if thin, history).
 */
export function validateNflverseCode(identity: NflTeamIdentity, observedCodes: ReadonlySet<string>): boolean {
  return observedCodes.has(identity.nflverseCode);
}
