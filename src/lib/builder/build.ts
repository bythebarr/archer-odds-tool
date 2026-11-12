/**
 * The parlay builder: from every leg on the board, the ones that clear your
 * bars (hit rate over a window, ARCHR's chance, ARCHR's edge, sports), ranked,
 * and stacked into parlays of the size you asked for. Legs from different games
 * are close to independent, so a parlay's chance is the product of its legs'
 * (ARCHR's and the record's alike). One leg per game unless same-game legs are
 * allowed, and never two legs of one market (both sides, two rungs).
 *
 * Several parlays come back, not one: each leg joins at most two of them, so
 * the list shows the strongest stack and then real alternatives. Pure.
 */
import { americanToDecimal, decimalToAmerican } from "@/lib/odds/americanOdds";
import type { BuilderLeg, BuilderWindow } from "./types";
import { sameGameCorrelationFactor } from "./correlation";
import { trustedRelativeEdge } from "./conservative";
import { cautiousEdge } from "@/lib/propModel/canonical";
import { statShown } from "@/lib/props/statTiles";

/** A leg's CAUTIOUS edge over a window — the canonical ranking signal (see lib/propModel/canonical); null without a price or a read. (Historical name kept for callers.) */
export const legConservativeEdge = (l: BuilderLeg, w: BuilderWindow) => cautiousEdge(l.archr, l.rates[w], l.priceAmerican, l.roleRates?.[w]);

export type BuilderSort = "archr" | "edge" | "cedge" | "hit";

export interface BuilderOptions {
  /** Sports to draw from; empty = every sport. */
  sports: string[];
  /** One game (a leg's eventId) to draw from; empty = any. */
  game?: string;
  /** One team (a sport-scoped key, "nba:BOS") the legs must be about; empty = any. */
  team?: string;
  /** Prop stats switched off on the stat tiles ("nba:STL"); game lines are never filtered by these. */
  excludeStats?: string[];
  legs: number;
  window: BuilderWindow;
  /** Each leg's record over the window must be at least this (0–1). */
  minRate: number;
  /** ARCHR's chance on each leg at least this (0 = any, and legs ARCHR can't read are allowed). */
  minArchr: number;
  /** ARCHR's edge on each leg at least this, as a fraction (null = any, and unpriced legs are allowed). */
  minEdge: number | null;
  sameGame: boolean;
  /** Skip legs priced shorter than this (−500); an unpriced leg, when ARCHR rates it surer than that price. −Infinity = any. */
  shortest: number;
  sort: BuilderSort;
  /** Parlays returned. */
  count?: number;
}

export interface BuiltParlay {
  legs: BuilderLeg[];
  /** All legs' best prices multiplied; null when a leg has none. */
  priceAmerican: number | null;
  /** ARCHR's chance all cash (legs treated as independent); null when a leg has no read. */
  archr: number | null;
  edge: number | null;
  /** The records multiplied: how often a parlay like this would have cashed, legs independent. */
  record: number;
}

/** Games a window's record needs before it counts. */
const MIN_GAMES: Record<BuilderWindow, number> = { l5: 5, l10: 8, l20: 12, season: 5 };
/** Each leg joins at most this many of the parlays returned. */
const MAX_USES = 2;
/**
 * An edge past this is ARCHR disagreeing with the book far more than it ever
 * earns (an alt rung its props model reads loosely, mostly): not counted as
 * edge, so it can't top an edge filter or ranking.
 */
export const MAX_TRUSTED_EDGE = 0.5;
const trustedEdge = (l: BuilderLeg) => (l.edge !== null && l.edge <= MAX_TRUSTED_EDGE ? l.edge : null);
const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

const rateOf = (l: BuilderLeg, w: BuilderWindow) => {
  const [h, n] = l.rates[w];
  return n ? h / n : 0;
};

/** Low end of the record's range at one standard error, so 5 of 5 doesn't outrank 18 of 20. */
function floor(hits: number, n: number): number {
  if (!n) return 0;
  const p = hits / n;
  const d = 1 + 1 / n;
  return (p + 1 / (2 * n) - Math.sqrt((p * (1 - p)) / n + 1 / (4 * n * n))) / d;
}

/** The sport, game, team and stat filters: where a leg comes from, before its numbers are read. */
export function inScope(l: BuilderLeg, o: Pick<BuilderOptions, "sports" | "game" | "team" | "excludeStats">): boolean {
  if (o.sports.length && !o.sports.includes(l.sport)) return false;
  if (o.game && l.eventId !== o.game) return false;
  if (o.team && !(l.teams ?? []).includes(o.team)) return false;
  if (o.excludeStats?.length && l.kind === "prop" && l.stat && !statShown(o.excludeStats, l.sport, l.stat)) return false;
  return true;
}

export function qualifies(l: BuilderLeg, o: BuilderOptions): boolean {
  if (!inScope(l, o)) return false;
  const [, n] = l.rates[o.window];
  if (n < MIN_GAMES[o.window] || rateOf(l, o.window) < o.minRate) return false;
  if (o.minArchr > 0 && (l.archr === null || l.archr < o.minArchr)) return false;
  const edge = trustedEdge(l);
  if (o.minEdge !== null && (edge === null || edge < o.minEdge)) return false;
  if (o.shortest > -Infinity) {
    if (l.priceAmerican !== null ? l.priceAmerican < o.shortest : l.archr !== null && l.archr > implied(o.shortest)) return false;
  }
  return true;
}

export function scoreOf(l: BuilderLeg, o: BuilderOptions): number {
  const [h, n] = l.rates[o.window];
  if (o.sort === "edge") return trustedEdge(l) ?? -1;
  if (o.sort === "cedge") return trustedRelativeEdge(legConservativeEdge(l, o.window)) ?? -1;
  if (o.sort === "archr") return l.archr ?? floor(h, n) - 0.5;
  return floor(h, n);
}

function summarize(legs: BuilderLeg[], w: BuilderWindow): BuiltParlay {
  const priced = legs.every((l) => l.priceAmerican !== null);
  const dec = priced ? legs.reduce((p, l) => p * americanToDecimal(l.priceAmerican!), 1) : null;
  // Same-game legs share one game script — their joint chances carry the
  // correlation haircut (Decision 13), on the record as on ARCHR's read.
  const corr = sameGameCorrelationFactor(legs.map((l) => l.eventId));
  const archr = legs.every((l) => l.archr !== null) ? legs.reduce((p, l) => p * l.archr!, 1) * corr : null;
  return {
    legs,
    priceAmerican: dec === null ? null : Math.round(decimalToAmerican(dec)),
    archr,
    edge: archr !== null && dec !== null ? archr * dec - 1 : null,
    record: legs.reduce((p, l) => p * rateOf(l, w), 1) * corr,
  };
}

export function buildParlays(pool: BuilderLeg[], o: BuilderOptions): { qualifying: number; parlays: BuiltParlay[] } {
  const ranked = pool
    .filter((l) => qualifies(l, o))
    .map((l) => ({ l, score: scoreOf(l, o) }))
    .sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id))
    .map((x) => x.l);
  const uses = new Map<string, number>();
  const seen = new Set<string>();
  const parlays: BuiltParlay[] = [];
  for (let attempt = 0; attempt < (o.count ?? 6) * 3 && parlays.length < (o.count ?? 6); attempt++) {
    const legs: BuilderLeg[] = [];
    const events = new Set<string>();
    const groups = new Set<string>();
    for (const l of ranked) {
      if (legs.length >= o.legs) break;
      if ((uses.get(l.id) ?? 0) >= MAX_USES || groups.has(l.group) || (!o.sameGame && events.has(l.eventId))) continue;
      legs.push(l);
      events.add(l.eventId);
      groups.add(l.group);
    }
    if (legs.length < o.legs) break;
    for (const l of legs) uses.set(l.id, (uses.get(l.id) ?? 0) + 1);
    const key = legs.map((l) => l.id).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    parlays.push(summarize(legs, o.window));
  }
  return { qualifying: ranked.length, parlays };
}
