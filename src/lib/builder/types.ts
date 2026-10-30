/**
 * The parlay builder's one leg shape, every sport and market: a player prop, a
 * moneyline, a spread or a total, with its best price, ARCHR's chance, and how
 * often the same bet has cashed over the last 5, 10, 20 games and this season.
 * Each sport's source (lib/builder/sources) turns its own data into these; the
 * builder (build.ts) only ever sees this. JSON-safe: it is cached as is.
 */

/** A hit-rate window: the last 5, 10 or 20 games, or this season (the last 12 months where a sport has no season). */
export type BuilderWindow = "l5" | "l10" | "l20" | "season";
export const WINDOWS: BuilderWindow[] = ["l5", "l10", "l20", "season"];

/** [hits, games]. */
export type Rate = [number, number];

export type BuilderKind = "prop" | "ml" | "spread" | "total";

export interface BuilderLeg {
  /** Unique across the whole pool. */
  id: string;
  /** Filter key: "nba", "nfl", "ufc", or an all-sports sport ("soccer", "hockey", …). */
  sport: string;
  /** Readable league: "NBA", "Premier League". */
  league: string;
  /** One game, fight or match: legs sharing it are a same-game parlay. */
  eventId: string;
  /** "BOS @ NYK". */
  eventLabel: string;
  /** ISO start. */
  startsAt: string;
  href: string;
  kind: BuilderKind;
  /** "Jaylen Brown Over 14.5 PTS", "Celtics ML", "Celtics −3.5", "Over 221.5". */
  label: string;
  /** Legs that can't share a parlay (both sides of one market, two rungs of one stat). */
  group: string;
  priceAmerican: number | null;
  bookName: string | null;
  /** ARCHR's chance this leg cashes; null where ARCHR has no read. */
  archr: number | null;
  /** EV of the best price at ARCHR's chance, as a fraction; null without both. */
  edge: number | null;
  rates: Record<BuilderWindow, Rate>;
}

/** One hit-rate history entry, newest first: did the same bet cash that game, and in which season. */
export interface Outcome {
  hit: boolean;
  season: number;
}

/** A leg's rates over each window from its outcomes (newest first). */
export function ratesOf(outcomes: Outcome[], season: number): Record<BuilderWindow, Rate> {
  const count = (list: Outcome[]): Rate => [list.filter((o) => o.hit).length, list.length];
  return {
    l5: count(outcomes.slice(0, 5)),
    l10: count(outcomes.slice(0, 10)),
    l20: count(outcomes.slice(0, 20)),
    season: count(outcomes.filter((o) => o.season === season)),
  };
}

const decimal = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);

/** EV of a price at a chance, as a fraction of stake. */
export function edgeOf(prob: number | null, priceAmerican: number | null): number | null {
  return prob === null || priceAmerican === null ? null : prob * decimal(priceAmerican) - 1;
}
