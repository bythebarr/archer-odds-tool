/**
 * The same-game parlay finder: from every line a game's books hang (main lines
 * and alt rungs), the combinations whose legs have all cashed together most
 * often in the games their players shared — 2 legs up to 15.
 *
 * Each leg's history becomes two bit patterns over the game's shared calendar
 * (which games the player played, which of those the leg cashed), so a
 * combination's record is a handful of ANDs: cheap enough to search thousands
 * of combinations in the browser. The search is a beam: at each size it keeps
 * the best combinations and tries adding every other leg to each. A
 * combination is ranked by the low end of its hit rate's confidence range
 * (Wilson, one standard error), so 9 of 10 doesn't beat 28 of 30.
 *
 * Past joint hits are a description, not a forecast: searching thousands of
 * combinations always turns up some that cashed together by luck. The finder
 * shows the model's own chance beside the record for that reason. Pure.
 */
import { americanToDecimal, decimalToAmerican } from "@/lib/odds/americanOdds";
import { parlayGameKey, type ParlayLeg } from "./parlay";

export interface FinderLeg extends ParlayLeg {
  /** Unique per player, stat, side and number. */
  key: string;
  /** One leg per group in a parlay (a player's stat: its rungs are nested). */
  group: string;
  /** The best bettable price at this number, or null if no book hangs it. */
  priceAmerican: number | null;
  bookName: string | null;
}

export interface FinderOptions {
  /** A leg must have cashed at least this often on its own (0–1). */
  minLegRate: number;
  /** A combination's record needs at least this many shared games… */
  minShared: number;
  /** …and all its legs must have cashed together at least this often (0–1). */
  minRate: number;
  maxLegs: number;
  /** Combinations kept per size while searching. */
  beam: number;
  /** Combinations returned per size. */
  perSize: number;
  /** Only count these seasons' games (all when omitted). */
  seasons?: number[];
}

export const DEFAULT_FINDER: FinderOptions = { minLegRate: 0.6, minShared: 10, minRate: 0.5, maxLegs: 15, beam: 60, perSize: 3 };

export interface FoundParlay {
  legs: FinderLeg[];
  hits: number;
  shared: number;
  /** All legs cashed, over the last ten shared games. */
  last10: { hits: number; shared: number };
  /** The price if the legs were unrelated (every leg's best price multiplied); null when a leg has none. */
  priceAmerican: number | null;
  /** ARCHR's chance tonight if the legs were unrelated; null when a leg has no projection. */
  model: number | null;
}

/** Candidate legs searched, the strongest on their own first. */
const MAX_LEGS = 200;

type Bits = Uint32Array;
const words = (n: number) => Math.ceil(n / 32);
function popcount(b: Bits): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) {
    let v = b[i];
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    c += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return c;
}
function and(a: Bits, b: Bits): Bits {
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] & b[i];
  return out;
}

/** Wilson lower bound at one standard error: rewards a record that holds over more games. */
export function rateFloor(hits: number, n: number): number {
  if (n === 0) return 0;
  const z = 1;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - spread) / d;
}

export function parlayPrice(legs: FinderLeg[]): number | null {
  if (legs.some((l) => l.priceAmerican === null)) return null;
  const dec = legs.reduce((p, l) => p * americanToDecimal(l.priceAmerican!), 1);
  return Math.round(decimalToAmerican(dec));
}

interface State {
  idx: number[];
  played: Bits;
  hit: Bits;
  shared: number;
  hits: number;
  score: number;
}

export function findParlays(legs: FinderLeg[], options: Partial<FinderOptions> = {}): { size: number; parlays: FoundParlay[] }[] {
  const o = { ...DEFAULT_FINDER, ...options };
  const seasons = o.seasons ? new Set(o.seasons) : null;

  // The game calendar: every game any leg's player played, newest first.
  const dateOf = new Map<string, string>();
  for (const leg of legs)
    for (const l of leg.logs) {
      if (l.value === null || (seasons && !seasons.has(l.season))) continue;
      dateOf.set(parlayGameKey(leg.team, l), l.date);
    }
  const keys = [...dateOf.keys()].sort((a, b) => dateOf.get(b)!.localeCompare(dateOf.get(a)!));
  const index = new Map(keys.map((k, i) => [k, i]));
  const W = words(keys.length);
  const recent = new Uint32Array(W);
  for (let i = 0; i < Math.min(10, keys.length); i++) recent[i >> 5] |= 1 << (i & 31);

  const played: Bits[] = [];
  const hit: Bits[] = [];
  const usable: number[] = [];
  legs.forEach((leg, li) => {
    const p = new Uint32Array(W);
    const h = new Uint32Array(W);
    for (const l of leg.logs) {
      if (l.value === null || (seasons && !seasons.has(l.season))) continue;
      const i = index.get(parlayGameKey(leg.team, l))!;
      p[i >> 5] |= 1 << (i & 31);
      if (leg.side === "over" ? l.value > leg.point : l.value < leg.point) h[i >> 5] |= 1 << (i & 31);
    }
    played.push(p);
    hit.push(h);
    const n = popcount(p);
    if (n >= o.minShared && popcount(h) / n >= o.minLegRate) usable.push(li);
  });
  // The strongest legs on their own seed the search; past a couple hundred, the rest only slow it down.
  if (usable.length > MAX_LEGS) {
    const floor = (i: number) => rateFloor(popcount(hit[i]), popcount(played[i]));
    usable.sort((x, y) => floor(y) - floor(x)).splice(MAX_LEGS);
  }

  const out: { size: number; parlays: FoundParlay[] }[] = [];
  const seen = new Set<string>();
  const result = (s: State): FoundParlay => {
    const chosen = s.idx.map((i) => legs[i]);
    // "Last ten" is the ten most recent games all the players shared.
    const recentShared = new Uint32Array(W);
    let taken = 0;
    for (let i = 0; i < keys.length && taken < 10; i++) {
      if (s.played[i >> 5] & (1 << (i & 31))) {
        recentShared[i >> 5] |= 1 << (i & 31);
        taken++;
      }
    }
    return {
      legs: chosen,
      hits: s.hits,
      shared: s.shared,
      last10: { hits: popcount(and(s.hit, recentShared)), shared: taken },
      priceAmerican: parlayPrice(chosen),
      model: chosen.every((l) => l.modelProb !== null) ? chosen.reduce((p, l) => p * l.modelProb!, 1) : null,
    };
  };

  let beam: State[] = usable.map((i) => {
    const shared = popcount(played[i]);
    const hits = popcount(hit[i]);
    return { idx: [i], played: played[i], hit: hit[i], shared, hits, score: rateFloor(hits, shared) };
  });
  for (let size = 2; size <= o.maxLegs && beam.length; size++) {
    const next: State[] = [];
    for (const s of beam) {
      const groups = new Set(s.idx.map((i) => legs[i].group));
      for (const j of usable) {
        if (groups.has(legs[j].group)) continue;
        const p = and(s.played, played[j]);
        const shared = popcount(p);
        if (shared < o.minShared) continue;
        const h = and(s.hit, hit[j]);
        const hits = popcount(h);
        if (hits / shared < o.minRate) continue;
        const key = [...s.idx, j].sort((x, y) => x - y).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ idx: [...s.idx, j], played: p, hit: h, shared, hits, score: rateFloor(hits, shared) });
      }
    }
    next.sort((a, b) => b.score - a.score || b.shared - a.shared);
    beam = next.slice(0, o.beam);
    if (beam.length) out.push({ size, parlays: beam.slice(0, o.perSize).map(result) });
  }
  return out;
}
