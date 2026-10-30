/**
 * The props screener: every player prop on the board (NBA, NFL, soccer), each
 * with its record at tonight's number over the last 3, 5, 10, 15 games, this
 * season and last season, and the filters that cut it down — a bar on any
 * window (or all of them), the sport, game, team, stat and side, main line or
 * alt rungs, ARCHR's chance and edge, and a price range. Pure.
 */

export type ScreenWindow = "l3" | "l5" | "l10" | "l15" | "szn" | "last";
export const SCREEN_WINDOWS: { key: ScreenWindow; label: string }[] = [
  { key: "l3", label: "L3" },
  { key: "l5", label: "L5" },
  { key: "l10", label: "L10" },
  { key: "l15", label: "L15" },
  { key: "szn", label: "This szn" },
  { key: "last", label: "Last szn" },
];

/** [hits, games]; [0, 0] where the window has no games (or the sport keeps no such history). */
export type Rate = [number, number];

export interface ScreenerProp {
  id: string;
  /** "nba" | "nfl" | "soccer". */
  sport: string;
  league: string;
  gameId: string;
  /** "BOS @ NYK". */
  game: string;
  startsAt: string;
  team: string;
  opponent: string;
  player: string;
  /** The sport's stat key and its short label ("PTS"). */
  stat: string;
  statLabel: string;
  side: "over" | "under" | "yes";
  point: number;
  /** The book's main number for this player and stat (alt rungs are false). */
  main: boolean;
  priceAmerican: number | null;
  bookName: string | null;
  archr: number | null;
  edge: number | null;
  rates: Record<ScreenWindow, Rate>;
  /** Soccer: the league's slug, for the link to its props board. */
  leagueSlug?: string;
}

/** The sport's props board for this prop's game or league (kept off the row: the cached slice must stay small). */
export function propHref(p: Pick<ScreenerProp, "sport" | "gameId" | "leagueSlug">): string {
  if (p.sport === "soccer") return `/sports/soccer/props${p.leagueSlug ? `?league=${p.leagueSlug}` : ""}`;
  return `/${p.sport}/props?game=${p.gameId.slice(p.sport.length + 1)}`;
}

/** A window's record from game values (newest first, null = not on the box score), at a side and number. */
export function screenRates(
  logs: { season: number; value: number | null }[],
  side: "over" | "under" | "yes",
  point: number,
  season: number
): Record<ScreenWindow, Rate> {
  const games = logs.filter((l) => l.value !== null) as { season: number; value: number }[];
  const hit = (v: number) => (side === "under" ? v < point : v > point);
  const count = (list: typeof games): Rate => [list.filter((g) => hit(g.value)).length, list.length];
  return {
    l3: count(games.slice(0, 3)),
    l5: count(games.slice(0, 5)),
    l10: count(games.slice(0, 10)),
    l15: count(games.slice(0, 15)),
    szn: count(games.filter((g) => g.season === season)),
    last: count(games.filter((g) => g.season === season - 1)),
  };
}

export type ScreenSort = ScreenWindow | "archr" | "edge" | "price";

export interface ScreenFilters {
  sport: string | null;
  gameId: string | null;
  team: string | null;
  stat: string | null;
  side: "over" | "under" | "yes" | null;
  /** Main lines only (default) or every alt rung too. */
  mainOnly: boolean;
  /** A bar on each window (0 = none); `all` applies to every window. */
  min: Partial<Record<ScreenWindow, number>>;
  all: number;
  /** A window needs at least this many games before its bar counts it as met. */
  minGames: number;
  minArchr: number;
  minEdge: number | null;
  /** Price range, American; null = open. */
  shortest: number | null;
  longest: number | null;
  sort: ScreenSort;
}

export const DEFAULT_FILTERS: ScreenFilters = {
  sport: null,
  gameId: null,
  team: null,
  stat: null,
  side: null,
  mainOnly: true,
  min: {},
  all: 0,
  minGames: 3,
  minArchr: 0,
  minEdge: null,
  shortest: null,
  longest: null,
  sort: "l10",
};

/** An edge past this is the props model misreading an alt rung, not value (see the parlay builder). */
const MAX_TRUSTED_EDGE = 0.5;

const rateOf = ([h, n]: Rate) => (n ? h / n : -1);

/** Each window's bar: the larger of its own and the all-windows bar. */
export function barsOf(f: ScreenFilters): Partial<Record<ScreenWindow, number>> {
  const out: Partial<Record<ScreenWindow, number>> = {};
  for (const { key } of SCREEN_WINDOWS) {
    const bar = Math.max(f.min[key] ?? 0, f.all);
    if (bar > 0) out[key] = bar;
  }
  return out;
}

export function passes(p: ScreenerProp, f: ScreenFilters): boolean {
  if (f.sport && p.sport !== f.sport) return false;
  if (f.gameId && p.gameId !== f.gameId) return false;
  if (f.team && p.team !== f.team) return false;
  if (f.stat && p.stat !== f.stat) return false;
  if (f.side && p.side !== f.side) return false;
  if (f.mainOnly && !p.main) return false;
  for (const [w, bar] of Object.entries(barsOf(f)) as [ScreenWindow, number][]) {
    const [h, n] = p.rates[w];
    // A window with too few games can't show the player clears it.
    if (n < Math.min(f.minGames, w === "l3" ? 3 : f.minGames) || h / n < bar) return false;
  }
  if (f.minArchr > 0 && (p.archr === null || p.archr < f.minArchr)) return false;
  if (f.minEdge !== null && (p.edge === null || p.edge > MAX_TRUSTED_EDGE || p.edge < f.minEdge)) return false;
  if (f.shortest !== null && (p.priceAmerican === null || p.priceAmerican < f.shortest)) return false;
  if (f.longest !== null && (p.priceAmerican === null || p.priceAmerican > f.longest)) return false;
  return true;
}

function sortValue(p: ScreenerProp, s: ScreenSort): number {
  if (s === "archr") return p.archr ?? -1;
  if (s === "edge") return p.edge !== null && p.edge <= MAX_TRUSTED_EDGE ? p.edge : -1;
  if (s === "price") return p.priceAmerican ?? -Infinity;
  return rateOf(p.rates[s]);
}

/** The props that pass, best first by the chosen sort (ties: more games in the window, then the longer record). */
export function screen(pool: ScreenerProp[], f: ScreenFilters): ScreenerProp[] {
  const tie = (p: ScreenerProp) => (f.sort in p.rates ? p.rates[f.sort as ScreenWindow][1] : 0);
  return pool
    .filter((p) => passes(p, f))
    .sort((a, b) => sortValue(b, f.sort) - sortValue(a, f.sort) || tie(b) - tie(a) || rateOf(b.rates.l10) - rateOf(a.rates.l10) || a.id.localeCompare(b.id));
}

/**
 * The book's main number among a stat's posted lines: the number both sides
 * are hung at (alt ladders are Over-only), the most books first, then the
 * price nearest even money. A Yes-only stat's one number; null when nothing is posted.
 */
export function mainPoint(lines: { side: string; point: number; priceAmerican?: number | null; bookKey?: string }[]): number | null {
  if (!lines.length) return null;
  const by = new Map<number, { over: number; under: number; nearEven: number }>();
  for (const l of lines) {
    const e = by.get(l.point) ?? { over: 0, under: 0, nearEven: Infinity };
    if (l.side === "under") e.under++;
    else e.over++;
    if (l.priceAmerican !== null && l.priceAmerican !== undefined) e.nearEven = Math.min(e.nearEven, Math.abs(Math.abs(l.priceAmerican) - 110));
    by.set(l.point, e);
  }
  const twoSided = [...by].filter(([, e]) => e.over > 0 && e.under > 0);
  const pool = twoSided.length ? twoSided : by.size === 1 ? [...by] : [];
  if (!pool.length) return null;
  pool.sort(([, a], [, b]) => Math.min(b.over, b.under) - Math.min(a.over, a.under) || a.nearEven - b.nearEven);
  return pool[0]![0];
}
