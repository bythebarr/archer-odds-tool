/**
 * The parlay generator: N legs from every leg that clears your filters, drawn
 * at random but weighted toward the strongest, so each press of Generate gives
 * a different parlay that still checks out. Legs you lock stay; the rest are
 * drawn around them (never a second leg from a locked leg's game, unless
 * same-game legs are allowed, and never two legs of one market). When the
 * filters leave too few games to fill the parlay, it says how many it could
 * find instead of padding it with legs that don't qualify. Pure.
 *
 * Prices: many props reach the feed before (or without) a book's price. Those
 * legs carry ARCHR's fair price instead (its chance as odds, no vig), marked
 * as such, so a parlay can still be priced; the total is then an estimate.
 */
import { americanToDecimal, decimalToAmerican } from "@/lib/odds/americanOdds";
import { qualifies, scoreOf, type BuilderOptions } from "./build";
import type { BuilderKind, BuilderLeg, BuilderWindow } from "./types";

export interface GenerateOptions extends BuilderOptions {
  /** Bet types to draw from; empty = all (props, moneylines, spreads, totals). */
  kinds: BuilderKind[];
  /** Only legs a book has priced. */
  pricedOnly: boolean;
}

export interface GeneratedLeg extends BuilderLeg {
  /** The book's price, or ARCHR's fair price where no book has one; null with neither. */
  displayPrice: number | null;
  /** True when displayPrice is ARCHR's fair price, not a book's. */
  fair: boolean;
  locked: boolean;
}

export interface GeneratedParlay {
  legs: GeneratedLeg[];
  /** The legs' prices multiplied (fair prices where a book has none); null if any leg has neither. */
  priceAmerican: number | null;
  /** True when a fair price went into the total. */
  estimated: boolean;
  archr: number | null;
  /** Every leg's record over the window multiplied. */
  record: number;
}

export interface GenerateResult {
  parlay: GeneratedParlay;
  /** Legs that clear the filters (before the locked legs' games are taken out). */
  qualifying: number;
  /** Legs short of the count asked for; 0 when the parlay is full. */
  short: number;
}

/** A leg's fair price from ARCHR's chance (no vig). */
export function fairAmerican(prob: number | null): number | null {
  if (prob === null || prob <= 0.01 || prob >= 0.99) return null;
  return Math.round(decimalToAmerican(1 / prob));
}

/** Small seeded generator (mulberry32): the same seed draws the same parlay. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rateOf = (l: BuilderLeg, w: BuilderWindow) => {
  const [h, n] = l.rates[w];
  return n ? h / n : 0;
};

export function summarizeGenerated(legs: (BuilderLeg & { locked?: boolean })[], w: BuilderWindow): GeneratedParlay {
  const out: GeneratedLeg[] = legs.map((l) => {
    const fair = l.priceAmerican === null ? fairAmerican(l.archr) : null;
    return { ...l, displayPrice: l.priceAmerican ?? fair, fair: l.priceAmerican === null && fair !== null, locked: Boolean(l.locked) };
  });
  const priced = out.every((l) => l.displayPrice !== null);
  const dec = priced ? out.reduce((p, l) => p * americanToDecimal(l.displayPrice!), 1) : null;
  return {
    legs: out,
    priceAmerican: dec === null ? null : Math.round(decimalToAmerican(dec)),
    estimated: out.some((l) => l.fair),
    archr: out.length && out.every((l) => l.archr !== null) ? out.reduce((p, l) => p * l.archr!, 1) : null,
    record: out.length ? out.reduce((p, l) => p * rateOf(l, w), 1) : 0,
  };
}

/**
 * Draw a parlay of `o.legs` legs: the locked ones, then the rest at random from
 * the qualifying legs, weighted by rank (the best leg about e times likelier
 * than one a third of the way down the list). `exclude` keeps legs out of this
 * draw (the ones just shown, so Regenerate gives new ones), and is dropped if
 * honoring it would leave the parlay short.
 */
export function generateParlay(pool: BuilderLeg[], o: GenerateOptions & { lockedIds: string[]; exclude: string[]; seed: number }): GenerateResult {
  const byId = new Map(pool.map((l) => [l.id, l]));
  const locked = o.lockedIds.map((id) => byId.get(id)).filter((l): l is BuilderLeg => Boolean(l));
  const candidates = pool.filter(
    (l) => qualifies(l, o) && (!o.kinds.length || o.kinds.includes(l.kind)) && (!o.pricedOnly || l.priceAmerican !== null)
  );
  const ranked = candidates.map((l) => ({ l, s: scoreOf(l, o) })).sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id)).map((x) => x.l);

  const draw = (exclude: Set<string>): BuilderLeg[] => {
    const events = new Set(locked.map((l) => l.eventId));
    const groups = new Set(locked.map((l) => l.group));
    const ids = new Set(locked.map((l) => l.id));
    const fits = (l: BuilderLeg) => !ids.has(l.id) && !exclude.has(l.id) && !groups.has(l.group) && (o.sameGame || !events.has(l.eventId));
    const random = rng(o.seed);
    const picked: BuilderLeg[] = [];
    let pool = ranked.filter(fits);
    const need = o.legs - locked.length;
    while (picked.length < need && pool.length) {
      const scale = Math.max(4, pool.length / 3);
      const weights = pool.map((_, i) => Math.exp(-i / scale));
      let r = random() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
      const leg = pool[i];
      picked.push(leg);
      ids.add(leg.id);
      groups.add(leg.group);
      events.add(leg.eventId);
      pool = pool.filter(fits);
    }
    return picked;
  };

  const need = Math.max(0, o.legs - locked.length);
  let picked = draw(new Set(o.exclude));
  if (picked.length < need && o.exclude.length) picked = draw(new Set());
  const legs = [...locked.map((l) => ({ ...l, locked: true })), ...picked.map((l) => ({ ...l, locked: false }))];
  return { parlay: summarizeGenerated(legs, o.window), qualifying: candidates.length, short: need - picked.length };
}
