/**
 * CFB v0's baseline team-strength model — points scored/allowed, opponent-adjusted
 * by a deterministic iterative solver (SRS-style: each team's offense/defense
 * rating is the average of game-level values that reference the opponent's own
 * current rating, re-run for a fixed number of rounds), shrunk toward league
 * average early in the season. Pure and stateless — an array of completed games
 * in, ratings out. No Prisma, no I/O, no randomness. See docs/architecture/
 * CFB-V0.md for the full formula, the identifiability fix below, and why every
 * constant here is a named, documented heuristic rather than something fit to
 * historical results (that's on the roadmap, not in v0).
 *
 * IMPORTANT — identifiability (found in adversarial review, 2026-09-19): the
 * coupled equations
 *   offense[team] = avg(netPointsFor − defense[opponent])
 *   defense[team] = avg(netPointsAgainst − offense[opponent])
 * are invariant under the shift (offense[t] += c, defense[t] −= c) for EVERY
 * team t in a connected component, for any constant c — check it: offense's
 * equation loses a `−c` from `defense[opponent]` shifting by −c, gaining +c on
 * the left, so it still balances, and symmetrically for defense. That means
 * Gauss-Seidel has a whole one-parameter family of valid fixed points *per
 * connected component of the schedule graph*, and which one it lands on
 * depends on team visitation order — confirmed empirically: shuffling game
 * input order on a 10-team/20-game test graph moved net ratings by up to 6.7
 * points at 15, 60, and even 500 iterations (i.e. NOT a convergence-speed
 * problem — the iteration converges fast, just to a different point in the
 * family depending on order). The fix is the standard one for this class of
 * rating system: pin the free constant by recentering each connected
 * component's own mean offense to 0 after every round (see `recenterByComponent`
 * below). Re-verified after the fix: order-shuffle residual drops to ~1e-15
 * (float noise) at 30 iterations, both for a single connected graph and for a
 * genuinely disconnected one.
 *
 * KNOWN, SMALLER LIMITATION (same review): leagueAvgPoints is one number
 * shared across the whole input, not computed per component. Per-component
 * recentering guarantees each component's OFFENSE ratings are exactly
 * independent of every other component's results (verified in
 * ratings.test.ts) — but a change to a disconnected component's scores still
 * nudges the shared leagueAvgPoints, which very slightly shifts every OTHER
 * component's DEFENSE (and therefore net) rating's absolute level, without
 * changing any team's rank relative to its own component-mates. Measured
 * during review: swapping one component's scores for more lopsided ones
 * moved an unrelated component's net rating by ~0.17 on a graph where real
 * signal ran ~+/-30 points — a real but second-order effect, left as v0 scope
 * (a genuinely per-component league average raises its own ambiguity for
 * projecting an upcoming CROSS-component matchup, the one case where it would
 * matter most) rather than engineered around here. See CFB-V0.md.
 */
import { HOME_FIELD_POINTS } from "./model";
import type { CfbCompletedGame, CfbRatingBook, CfbTeamRating } from "./types";

/**
 * Round count for the Gauss-Seidel opponent-adjustment solver. Deterministic
 * by construction (fixed count, fixed team order per run — see the module
 * docstring for why order no longer matters once recentered). 30 is not a
 * tuned value; it's a comfortable safety margin — the order-shuffle residual
 * measured during review was already ~3e-5 at 15 rounds and ~1e-15 (float
 * noise) by 30, on a graph considerably sparser than a real FBS slate.
 */
export const SRS_ITERATIONS = 30;

/**
 * Early-season shrinkage strength, in "phantom average games." A team's raw
 * rating is multiplied by gamesPlayed / (gamesPlayed + SHRINK_GAMES) — a
 * 1-game team gets ~20% of its raw rating, a 4-game team ~50%, an 8-game team
 * ~67%. Heuristic, not fit to historical variance; see the roadmap.
 */
export const SHRINK_GAMES = 4;

/** Fallback league-average points/team when there are no games yet to average (very early season). A named, documented placeholder — not a fitted constant. */
export const DEFAULT_LEAGUE_AVG_POINTS = 27;

/**
 * A completed game's score, in absolute terms, beyond which it's more likely
 * a data glitch than a real result (the modern FBS single-game scoring record
 * is in the low 90s). Rejected at the ESPN-parsing layer
 * (`espnScoreboard.ts`'s `parseScoreboard`) before it can ever reach this
 * solver, so one bad number can't silently dominate a team's rating — kept
 * here too as the documented threshold both layers share.
 */
export const MAX_PLAUSIBLE_SCORE = 120;

const NEUTRAL_RATING: CfbTeamRating = {
  teamId: "",
  offenseRating: 0,
  defenseRating: 0,
  netRating: 0,
  gamesPlayed: 0,
  strengthOfSchedule: 0,
};

/** The rating for a team not present in the map (no completed games yet) — league-average-strength, zero sample, so the model's confidence logic correctly reads it as unproven. */
export function ratingOrDefault(ratings: ReadonlyMap<string, CfbTeamRating>, teamId: string): CfbTeamRating {
  return ratings.get(teamId) ?? { ...NEUTRAL_RATING, teamId };
}

interface GameRecord {
  teamId: string;
  opponentId: string;
  /** Points this team scored, home-field-neutralized and centered on league average. */
  netPointsFor: number;
  /** Points this team allowed, home-field-neutralized and centered on league average. */
  netPointsAgainst: number;
}

/** Connected components of the team/opponent graph (BFS) — a plain graph property, independent of traversal order. Two teams share a component iff there's a chain of common opponents connecting them. */
function connectedComponents(teamIds: readonly string[], adjacency: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const start of teamIds) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Pins the (offense += c, defense −= c) free constant described in the module
 * docstring, independently per connected component: each component's own
 * mean offense is forced to 0. This is also the honest way to handle a
 * disconnected schedule graph (e.g. very early season, before conferences
 * have cross-played) — two components with no common opponent have no data
 * connecting them, so each is centered on its OWN average rather than one
 * arbitrarily inheriting the other's scale. Cross-component numbers are not
 * more comparable than that; see CFB-V0.md's "known limitations".
 */
function recenterByComponent(components: readonly string[][], off: Map<string, number>, def: Map<string, number>): void {
  for (const members of components) {
    const meanOffense = members.reduce((sum, id) => sum + (off.get(id) ?? 0), 0) / members.length;
    for (const id of members) {
      off.set(id, (off.get(id) ?? 0) - meanOffense);
      def.set(id, (def.get(id) ?? 0) + meanOffense);
    }
  }
}

/**
 * Builds opponent-adjusted offense/defense/net ratings as of `asOfUtc`, plus
 * the league-average points figure they're relative to.
 *
 * Strict as-of cutoff, enforced here (not just trusted of the caller): any game
 * at or after `asOfUtc` is excluded before it ever reaches the solver, so a
 * caller accidentally passing an unfiltered season can't leak a target game's
 * own result into its own prediction.
 *
 * Also defensively deduplicates by `espnEventId` (not just trusted of the
 * caller): the same event appearing twice in the input — e.g. because a
 * caller merged two overlapping fetches — would otherwise double-count that
 * game's result for both teams.
 */
export function buildTeamRatings(games: readonly CfbCompletedGame[], asOfUtc: Date): CfbRatingBook {
  const seenEventIds = new Set<string>();
  const eligible = games.filter((g) => {
    if (g.startUtc.getTime() >= asOfUtc.getTime()) return false;
    if (seenEventIds.has(g.espnEventId)) return false;
    seenEventIds.add(g.espnEventId);
    return true;
  });
  if (eligible.length === 0) {
    return { ratings: new Map(), leagueAvgPoints: DEFAULT_LEAGUE_AVG_POINTS };
  }

  const leagueAvgPoints =
    eligible.reduce((sum, g) => sum + g.homeScore + g.awayScore, 0) / (eligible.length * 2);

  // One record per team per game, with home-field stripped so ratings reflect
  // team strength independent of venue (HFA is re-applied at prediction time,
  // in model.ts, using this same constant — see its docstring for the split).
  const records: GameRecord[] = [];
  for (const g of eligible) {
    const hfaSplit = g.neutralSite ? 0 : HOME_FIELD_POINTS / 2;
    records.push({
      teamId: g.homeTeamId,
      opponentId: g.awayTeamId,
      netPointsFor: g.homeScore - hfaSplit - leagueAvgPoints,
      netPointsAgainst: g.awayScore + hfaSplit - leagueAvgPoints,
    });
    records.push({
      teamId: g.awayTeamId,
      opponentId: g.homeTeamId,
      netPointsFor: g.awayScore + hfaSplit - leagueAvgPoints,
      netPointsAgainst: g.homeScore - hfaSplit - leagueAvgPoints,
    });
  }

  const byTeam = new Map<string, GameRecord[]>();
  const adjacency = new Map<string, Set<string>>();
  for (const r of records) {
    const list = byTeam.get(r.teamId);
    if (list) list.push(r);
    else byTeam.set(r.teamId, [r]);

    if (!adjacency.has(r.teamId)) adjacency.set(r.teamId, new Set());
    adjacency.get(r.teamId)!.add(r.opponentId);
  }

  const teamIds = [...byTeam.keys()];
  const components = connectedComponents(teamIds, adjacency);
  const off = new Map<string, number>(teamIds.map((id) => [id, 0]));
  const def = new Map<string, number>(teamIds.map((id) => [id, 0]));

  // Gauss-Seidel (each team's new value is written in place and immediately
  // visible to the rest of the same round — needed for reasonable convergence
  // speed on a sparse graph), followed each round by the per-component
  // recentering that pins the free additive constant described in the module
  // docstring. Without that recentering step this iteration is NOT
  // order-independent — see the docstring and `ratings.test.ts`'s
  // "order independence" tests for the empirical proof.
  for (let iter = 0; iter < SRS_ITERATIONS; iter++) {
    for (const teamId of teamIds) {
      const teamRecords = byTeam.get(teamId) ?? [];
      const offSum = teamRecords.reduce((sum, r) => sum + (r.netPointsFor - (def.get(r.opponentId) ?? 0)), 0);
      const defSum = teamRecords.reduce((sum, r) => sum + (r.netPointsAgainst - (off.get(r.opponentId) ?? 0)), 0);
      off.set(teamId, offSum / teamRecords.length);
      def.set(teamId, defSum / teamRecords.length);
    }
    recenterByComponent(components, off, def);
  }

  const gamesPlayed = new Map<string, number>(teamIds.map((id) => [id, byTeam.get(id)?.length ?? 0]));

  // Shrink offense/defense toward 0 (each component's own average) by sample
  // size, then derive net rating from the shrunk components (not the raw
  // ones) so strength-of-schedule and predictions both see the same,
  // regularized number.
  const shrunkNet = new Map<string, number>();
  const shrunkOff = new Map<string, number>();
  const shrunkDef = new Map<string, number>();
  for (const teamId of teamIds) {
    const n = gamesPlayed.get(teamId) ?? 0;
    const shrink = n / (n + SHRINK_GAMES);
    const o = (off.get(teamId) ?? 0) * shrink;
    const d = (def.get(teamId) ?? 0) * shrink;
    shrunkOff.set(teamId, o);
    shrunkDef.set(teamId, d);
    shrunkNet.set(teamId, o - d);
  }

  const ratings = new Map<string, CfbTeamRating>();
  for (const teamId of teamIds) {
    const teamRecords = byTeam.get(teamId) ?? [];
    const sos =
      teamRecords.length === 0
        ? 0
        : teamRecords.reduce((sum, r) => sum + (shrunkNet.get(r.opponentId) ?? 0), 0) / teamRecords.length;

    ratings.set(teamId, {
      teamId,
      offenseRating: shrunkOff.get(teamId) ?? 0,
      defenseRating: shrunkDef.get(teamId) ?? 0,
      netRating: shrunkNet.get(teamId) ?? 0,
      gamesPlayed: gamesPlayed.get(teamId) ?? 0,
      strengthOfSchedule: sos,
    });
  }

  return { ratings, leagueAvgPoints };
}
