/**
 * NFL SRS v0's baseline team-strength model — points scored/allowed, opponent-
 * adjusted by a deterministic iterative solver. This is a direct structural port of
 * `src/lib/cfb/ratings.ts` (same Gauss-Seidel SRS solver, same per-connected-
 * component recentering fix, same shrinkage shape) — see that file's own docstring
 * for the full derivation and the identifiability proof; it isn't re-derived here.
 * Pure and stateless — an array of completed games in, ratings out. No Prisma, no I/O,
 * no randomness.
 *
 * What's genuinely different from CFB, not just renamed:
 *
 * - **Data source**: games come from `historicalGames.ts` (nflverse's free
 *   `games.csv`, already regular-season-filtered), not a live ESPN scoreboard call
 *   — so there's no in-memory HTTP cache layer here; the caller fetches once and
 *   passes the array in.
 * - **Schedule connectivity**: NFL's 32-team, fully round-robin-within-division
 *   schedule (every team plays every division rival twice, plus a full rotation of
 *   cross-division games) is far better connected than CFB's ~130-team, FCS-
 *   "buy game"-laden one. The disconnected-component edge case CFB's own review
 *   found is far less likely to bite here, but the same defensive per-component
 *   recentering is kept rather than assumed away.
 * - **Constants**: `SHRINK_GAMES`/`SRS_ITERATIONS` start at CFB's own values (a
 *   reasonable starting point for the same class of solver) but, unlike CFB
 *   (whose constants are documented, permanent placeholders — no real market data
 *   to fit against), NFL's home-field points / margin-SD / total-SD constants in
 *   `model.ts` are meant to be genuinely FIT against nflverse's real closing-line
 *   history (see `scripts/fit-nfl-srs-constants.ts`) — see that script and
 *   `model.ts`'s own constant comments for the fit methodology and result.
 */
import { HOME_FIELD_POINTS } from "./model";
import type { NflCompletedGame, NflRatingBook, NflTeamRating } from "./types";

/** Round count for the Gauss-Seidel opponent-adjustment solver — same value and rationale as CFB's `SRS_ITERATIONS` (order-shuffle residual is float-noise-level well before this). */
export const SRS_ITERATIONS = 30;

/** Early-season shrinkage strength, in "phantom average games" — same shape as CFB's `SHRINK_GAMES`. A 1-game team gets ~20% of its raw rating, a 4-game team ~50%, an 8-game team ~67%. */
export const SHRINK_GAMES = 4;

/** Fallback league-average points/team when there are no games yet to average (preseason, before week 1 completes). */
export const DEFAULT_LEAGUE_AVG_POINTS = 22;

const NEUTRAL_RATING: NflTeamRating = {
  teamId: "",
  offenseRating: 0,
  defenseRating: 0,
  netRating: 0,
  gamesPlayed: 0,
  strengthOfSchedule: 0,
};

/** The rating for a team not present in the map (no completed games yet) — league-average-strength, zero sample. */
export function ratingOrDefault(ratings: ReadonlyMap<string, NflTeamRating>, teamId: string): NflTeamRating {
  return ratings.get(teamId) ?? { ...NEUTRAL_RATING, teamId };
}

interface GameRecord {
  teamId: string;
  opponentId: string;
  netPointsFor: number;
  netPointsAgainst: number;
}

/** Connected components of the team/opponent graph (BFS) — identical to CFB's `connectedComponents`. */
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

/** Pins the (offense += c, defense −= c) free constant independently per connected component — identical rationale to CFB's `recenterByComponent`; see ratings.ts's CFB counterpart for the full identifiability proof. */
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
 * Builds opponent-adjusted offense/defense/net ratings as of `asOfUtc`, plus the
 * league-average points figure they're relative to. Strict as-of cutoff and
 * gameId dedup enforced here, not just trusted of the caller — same lookahead
 * discipline as CFB's `buildTeamRatings`.
 *
 * `homeFieldPoints` defaults to the fitted `HOME_FIELD_POINTS` constant but is
 * accepted as a parameter (unlike CFB's hard-wired import) specifically so
 * `scripts/fit-nfl-srs-constants.ts` can rebuild ratings under a candidate HFA
 * value while fitting it, without mutating module state or duplicating this
 * solver — every other caller can ignore this parameter entirely.
 */
export function buildTeamRatings(
  games: readonly NflCompletedGame[],
  asOfUtc: Date,
  homeFieldPoints: number = HOME_FIELD_POINTS
): NflRatingBook {
  const seenGameIds = new Set<string>();
  const eligible = games.filter((g) => {
    if (g.startUtc.getTime() >= asOfUtc.getTime()) return false;
    if (seenGameIds.has(g.gameId)) return false;
    seenGameIds.add(g.gameId);
    return true;
  });
  if (eligible.length === 0) {
    return { ratings: new Map(), leagueAvgPoints: DEFAULT_LEAGUE_AVG_POINTS };
  }

  const leagueAvgPoints = eligible.reduce((sum, g) => sum + g.homeScore + g.awayScore, 0) / (eligible.length * 2);

  // One record per team per game, with home-field stripped so ratings reflect
  // team strength independent of venue (HFA is re-applied at prediction time,
  // in model.ts, using this same constant).
  const records: GameRecord[] = [];
  for (const g of eligible) {
    const hfaSplit = g.neutralSite ? 0 : homeFieldPoints / 2;
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

  const ratings = new Map<string, NflTeamRating>();
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
