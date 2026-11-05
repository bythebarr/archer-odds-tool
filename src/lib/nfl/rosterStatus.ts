/**
 * Who can actually play for an NFL team this week, from ESPN (free, unkeyed):
 *
 *   - the team roster, in groups: offense, defense and special teams are the
 *     active 53; injured reserve / out, suspended and the practice squad aren't
 *     going to suit up (and a player on none of them has been released or traded)
 *   - the depth chart: each offensive player's spot (QB1, RB2, …)
 *
 * The props slate reads these before posting ARCHR's own line on a player, so a
 * backup quarterback, a receiver on IR or a back the team cut doesn't show up as
 * a play. Parsers are pure; fetches go through Next's data cache (an hour).
 */

/** Roster groups that don't play on Sunday, and what to call them. */
const OFF_GROUPS: Record<string, string> = {
  injuredReserveOrOut: "Injured reserve",
  suspended: "Suspended",
  practiceSquad: "Practice squad",
};

export interface NflRosterRead {
  /** ESPN's numeric team id (the depth chart is keyed by it). */
  espnTeamId: string | null;
  /** ESPN athlete ids on the active roster. */
  active: Set<string>;
  /** ESPN athlete id → why he's not active (IR, practice squad, suspended). */
  off: Map<string, string>;
}

export function parseNflRoster(payload: unknown): NflRosterRead {
  const p = payload as { team?: { id?: string | number }; athletes?: { position?: string; items?: { id?: string | number }[] }[] } | null;
  const active = new Set<string>();
  const off = new Map<string, string>();
  for (const group of p?.athletes ?? []) {
    const why = OFF_GROUPS[group.position ?? ""];
    for (const a of group.items ?? []) {
      if (a.id === undefined) continue;
      if (why) off.set(String(a.id), why);
      else active.add(String(a.id));
    }
  }
  // A player listed both ways (moved to IR mid-week) is off.
  for (const id of off.keys()) active.delete(id);
  return { espnTeamId: p?.team?.id !== undefined ? String(p.team.id) : null, active, off };
}

/** Position as ESPN keys it ("qb", "rb", "wr", "te", "pk", …) → his rank there (1 = the starter). */
export type DepthSpots = Record<string, number>;

/** ESPN athlete id → his best rank at each position he's listed at, across the team's depth charts. */
export function parseNflDepth(payload: unknown): Map<string, DepthSpots> {
  const out = new Map<string, DepthSpots>();
  const charts = (payload as { items?: { positions?: Record<string, { athletes?: { rank?: number; athlete?: { $ref?: string } }[] }> }[] } | null)?.items ?? [];
  for (const chart of charts) {
    for (const [position, spot] of Object.entries(chart.positions ?? {})) {
      for (const a of spot.athletes ?? []) {
        const id = a.athlete?.$ref?.match(/\/athletes\/(\d+)/)?.[1];
        if (!id || a.rank === undefined) continue;
        const spots = out.get(id) ?? {};
        if (spots[position] === undefined || a.rank < spots[position]) spots[position] = a.rank;
        out.set(id, spots);
      }
    }
  }
  return out;
}

export interface NflTeamStatus extends NflRosterRead {
  /** Empty when ESPN has no chart for the team. */
  depth: Map<string, DepthSpots>;
}

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** A team's roster and depth chart; null when ESPN doesn't answer (the slate then skips the check). */
export async function fetchNflTeamStatus(espnTeamCode: string, season: number): Promise<NflTeamStatus | null> {
  const roster = await getJson(`${SITE}/teams/${espnTeamCode}/roster`);
  if (!roster) return null;
  const read = parseNflRoster(roster);
  // An empty roster from a live feed is a bad answer, not a team with no players.
  if (read.active.size < 30) return null;
  const depth = read.espnTeamId ? parseNflDepth(await getJson(`${CORE}/seasons/${season}/teams/${read.espnTeamId}/depthcharts?limit=10`)) : new Map<string, DepthSpots>();
  return { ...read, depth };
}

/** Deepest spot at each position ARCHR still posts its own line for (a QB2 throws only when QB1 is hurt). */
const MAX_DEPTH: Record<string, number> = { QB: 1, RB: 3, WR: 5, TE: 3 };

/**
 * Whether ARCHR should post its own line on a player this week: why not, or
 * null when he's a play.
 *
 *   - Once a book has posted props on his game, only the players it lists: the
 *     book knows who's active, and its list is the betting menu.
 *   - Before that, the roster and depth chart: off the active 53 (IR, practice
 *     squad, released) or too deep on the chart, he's out of the pool.
 */
export function nflPoolExclusion(opts: {
  espnId: string;
  /** Position group: QB / RB / WR / TE. */
  position: string | null;
  /** ESPN ids a book has posted props for on his game; null before any are. */
  bookListed: Set<string> | null;
  status: NflTeamStatus | null;
}): string | null {
  const { espnId, position, bookListed, status } = opts;
  if (bookListed) return bookListed.has(espnId) ? null : "Not on the book's board for this game";
  if (!status) return null;
  const off = status.off.get(espnId);
  if (off) return off;
  if (!status.active.has(espnId)) return "Not on the active roster";
  if (status.depth.size > 0 && position) {
    const spots = status.depth.get(espnId);
    if (!spots) return "Not on the depth chart";
    const rank = spots[position.toLowerCase()];
    const max = MAX_DEPTH[position];
    if (max === undefined) return null;
    // A quarterback only throws as the starter; listed elsewhere only (the holder), he's not one.
    if (rank === undefined) return position === "QB" ? "Not the starting QB" : null;
    if (rank > max) return `${position}${rank} on the depth chart`;
  }
  return null;
}
