/**
 * Stat tiles: the props filters' stat categories as on/off tiles instead of a
 * single pick. Every stat starts on; switching tiles off weeds those stats out
 * (one, three, or all of them, then back on one by one). The URL carries only
 * what's switched OFF (`xstat`), so a stat new to the slate shows by default.
 * Keys are sport-scoped ("nba:points"), since two sports can share a stat
 * name. Pure and client-safe.
 */

export interface StatTile {
  key: string;
  /** "PTS", or "NBA PTS" where several sports share the tiles. */
  label: string;
  /** Rows or legs with this stat in the current scope. */
  count: number;
}

export const statTileKey = (sport: string, stat: string) => `${sport}:${stat}`;

/** The tiles for these items (each counting `n`, default 1): one per sport and stat, sport-labeled when more than one sport is present, by sport then label. */
export function statTiles(items: { sport: string; stat: string; label: string; n?: number }[], sportLabel: (sport: string) => string = (s) => s.toUpperCase()): StatTile[] {
  const tiles = new Map<string, StatTile & { sport: string; short: string }>();
  for (const it of items) {
    const key = statTileKey(it.sport, it.stat);
    const t = tiles.get(key);
    if (t) t.count += it.n ?? 1;
    else tiles.set(key, { key, label: it.label, short: it.label, sport: it.sport, count: it.n ?? 1 });
  }
  const multi = new Set([...tiles.values()].map((t) => t.sport)).size > 1;
  return [...tiles.values()]
    .map((t) => ({ ...t, label: multi ? `${sportLabel(t.sport)} ${t.short}` : t.short }))
    .sort((a, b) => a.sport.localeCompare(b.sport) || a.short.localeCompare(b.short))
    .map(({ key, label, count }) => ({ key, label, count }));
}

/** Read an `xstat` value: comma-separated and/or repeated (a form posts one per checked box). */
export function parseStatList(v: string | string[] | undefined | null): string[] {
  const parts = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(","));
  return [...new Set(parts.map((s) => s.trim()).filter(Boolean))];
}

/** Turn one tile on or off in an excluded list. */
export function toggleStat(excluded: string[], key: string): string[] {
  return excluded.includes(key) ? excluded.filter((k) => k !== key) : [...excluded, key];
}

/** Whether an item survives the tiles. */
export const statShown = (excluded: readonly string[], sport: string, stat: string) => !excluded.includes(statTileKey(sport, stat));
