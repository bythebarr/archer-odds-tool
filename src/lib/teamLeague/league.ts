/**
 * The shared shape of a team league on the odds feed + ESPN results pipeline.
 *
 * NFL was built first and everything about it except the data was
 * league-neutral: poll odds under a sport key, filter the competitors through a
 * closed team allowlist, store team-pair Game rows, settle them off ESPN's free
 * scoreboard, grade with the shared `gradeGame`. NBA is the same pipeline with a
 * different allowlist, sport key, and season boundary — so a league is a config
 * value, not a copy of the modules. See docs/architecture/nba-adapter.md.
 */

/** Sports that run on this pipeline. Each needs the Sport enum value and the team-pair DB check. */
export type TeamLeagueSport = "nfl" | "nba";

export interface LeagueTeamInfo {
  /** Canonical full name, stored as Team.name, e.g. "Kansas City Chiefs". */
  name: string;
  abbreviation: string;
  conference: string;
  division: string;
  /**
   * Other spellings the feeds are known to use for this team, e.g. ESPN's "LA
   * Clippers" for the odds feed's "Los Angeles Clippers". Explicit rather than
   * fuzzy for the same reason teamNameAliases.ts gives: a skipped game is
   * recoverable, another game's prices on the wrong team are corruption.
   */
  aliases?: readonly string[];
}

export interface TeamLeague {
  sport: TeamLeagueSport;
  /** Display label, e.g. "NFL". */
  label: string;
  /** The odds provider's sport key, e.g. "americanfootball_nfl". */
  oddsSportKey: string;
  /** ESPN scoreboard path under /sports, e.g. "football/nfl". */
  espnPath: string;
  /** PollLog job name for the odds poll, used for log lines too. */
  oddsJobName: string;
  /** The allowlisted team for a feed name, or null when it isn't one of this league's teams. */
  lookupTeam(name: string): LeagueTeamInfo | null;
  /** The season a game date belongs to. */
  seasonOf(date: Date): number;
}

/**
 * Case/punctuation/whitespace-insensitive key. Parlay's names are known to drift
 * in exactly these cosmetic ways (the MLB poll's comments record "Milwaukee
 * Brewers @ New York"-style mangling), so an exact string compare would drop real
 * games. Anything beyond cosmetic drift SHOULD miss — a wrong match is worse than
 * a skipped game, and skips are reported.
 */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Builds a name → team lookup over a league's allowlist, including each team's aliases. */
export function createTeamLookup<T extends LeagueTeamInfo>(teams: readonly T[]): (name: string) => T | null {
  const byNormalized = new Map<string, T>();
  for (const team of teams) {
    for (const name of [team.name, ...(team.aliases ?? [])]) {
      const key = normalizeTeamName(name);
      if (byNormalized.has(key)) throw new Error(`team allowlist: duplicate name "${name}"`);
      byNormalized.set(key, team);
    }
  }
  return (name) => byNormalized.get(normalizeTeamName(name)) ?? null;
}
