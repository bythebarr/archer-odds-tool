import { getSlateForDate, type Slate, type SlateItem } from "./slate";

/**
 * The home dashboard: a cross-sport "command center" derived from the same
 * normalized slate every sport already feeds. Surfaces the day's shape (counts
 * per sport) plus the highest-conviction plays — a single "play of the day" and
 * a rail of the next-strongest model leans — so the app opens on what's hot
 * everywhere, not on one sport.
 */
export interface Dashboard {
  date: string;
  counts: Slate["counts"];
  total: number;
  /** Highest model lean of the day (null if nothing modelable is on the board). */
  playOfTheDay: SlateItem | null;
  /** The next-strongest leans after the play of the day. */
  topLeans: SlateItem[];
}

/** How far the model leans from a coin flip, in [0,0.5]; null when there's no model (tennis/soccer today). */
export function leanStrength(item: SlateItem): number | null {
  const p = item.modelProb?.home;
  return p === null || p === undefined ? null : Math.abs(p - 0.5);
}

export async function getDashboardForDate(dateEt: string, railSize = 6): Promise<Dashboard> {
  const slate = await getSlateForDate(dateEt);

  const ranked = slate.items
    .map((item) => ({ item, lean: leanStrength(item) }))
    .filter((x): x is { item: SlateItem; lean: number } => x.lean !== null)
    .sort((a, b) => b.lean - a.lean)
    .map((x) => x.item);

  return {
    date: dateEt,
    counts: slate.counts,
    total: slate.items.length,
    playOfTheDay: ranked[0] ?? null,
    topLeans: ranked.slice(1, 1 + railSize),
  };
}
