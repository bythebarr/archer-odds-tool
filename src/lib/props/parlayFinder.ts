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
 * One player's stats nearly always move together (his points carry his
 * points + assists), so left alone those combinations crowd every slot of the
 * beam and the search never reaches mixes of several players. `maxPerPlayer`
 * caps a player's legs per parlay, and the beam keeps at most two
 * combinations of the same player-stats (two rungs of one combination are one
 * idea), which leaves room to grow the others.
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
  /** The player (or team) the leg is on: `maxPerPlayer` counts these. */
  player: string;
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
  /** At most this many legs on one player in a parlay. */
  maxPerPlayer: number;
  /** Combinations kept per size while searching. */
  beam: number;
  /** Combinations returned per size. */
  perSize: number;
  /** Only count these seasons' games (all when omitted). */
  seasons?: number[];
  /** Also return the best single legs (size 1), for pairing two teams' combinations. */
  includeSingles?: boolean;
}

export const DEFAULT_FINDER: FinderOptions = { minLegRate: 0.6, minShared: 10, minRate: 0.5, maxLegs: 15, maxPerPlayer: Infinity, beam: 150, perSize: 5 };

/** Beam states allowed per set of player-stats (the same combination at other rungs). */
const PER_SIGNATURE = 2;

export interface FoundParlay {
  legs: FinderLeg[];
  hits: number;
  shared: number;
  /** How often each leg cashed on its own in those same shared games (same order as legs). */
  legHits: number[];
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

/** The player-stats a combination covers, whatever the rungs. */
const signatureOf = (legs: FinderLeg[], idx: number[]) => idx.map((i) => legs[i].group).sort().join("|");

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
      legHits: s.idx.map((i) => popcount(and(hit[i], s.played))),
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
  if (o.includeSingles && beam.length) {
    const singles = [...beam].sort((a, b) => b.score - a.score || b.shared - a.shared);
    const shown = new Set<string>();
    const best = singles.filter((s) => {
      const g = legs[s.idx[0]].group;
      if (shown.has(g)) return false;
      shown.add(g);
      return true;
    });
    out.push({ size: 1, parlays: best.slice(0, o.perSize).map(result) });
  }
  for (let size = 2; size <= o.maxLegs && beam.length; size++) {
    const next: State[] = [];
    for (const s of beam) {
      const groups = new Set(s.idx.map((i) => legs[i].group));
      const perPlayer = new Map<string, number>();
      for (const i of s.idx) perPlayer.set(legs[i].player, (perPlayer.get(legs[i].player) ?? 0) + 1);
      for (const j of usable) {
        if (groups.has(legs[j].group) || (perPlayer.get(legs[j].player) ?? 0) >= o.maxPerPlayer) continue;
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
    // Keep the beam varied: a couple of rungs per combination, then the next idea.
    const bySignature = new Map<string, number>();
    beam = [];
    for (const s of next) {
      if (beam.length >= o.beam) break;
      const sig = signatureOf(legs, s.idx);
      const n = bySignature.get(sig) ?? 0;
      if (n >= PER_SIGNATURE) continue;
      bySignature.set(sig, n + 1);
      beam.push(s);
    }
    // What's shown: the best rung of each combination only.
    const shown = new Set<string>();
    const best = beam.filter((s) => {
      const sig = signatureOf(legs, s.idx);
      if (shown.has(sig)) return false;
      shown.add(sig);
      return true;
    });
    if (best.length) out.push({ size, parlays: best.slice(0, o.perSize).map(result) });
  }
  return out;
}

/**
 * A parlay with legs on both teams. Players on opposite teams only share the
 * games those two teams played each other (a handful), so a joint record across
 * teams says almost nothing. Instead each team's side is searched on its own
 * (its legs' record together in that team's games) and the two sides are
 * paired: the estimate is the two records multiplied, as if one team's side
 * says nothing about the other's. The head-to-head record, when the teams have
 * met, is shown beside it.
 */
export interface TwoTeamParlay {
  legs: FinderLeg[];
  /** Each team's side: its combination and record in that team's games. */
  sides: { team: string; parlay: FoundParlay }[];
  /** The sides' records multiplied. */
  estimate: number;
  /** Every leg cashed, in the games these two teams played each other. */
  h2h: { hits: number; shared: number };
  priceAmerican: number | null;
  model: number | null;
}

/** A side combination may appear in this many pairings per size (keeps the list varied). */
const PER_SIDE = 2;
/** Side combinations kept per size before pairing. */
const SIDE_PER_SIZE = 6;

function headToHead(legs: FinderLeg[], seasons: Set<number> | null): { hits: number; shared: number } {
  const maps = legs.map((leg) => {
    const m = new Map<string, boolean>();
    for (const l of leg.logs) {
      if (l.value === null || (seasons && !seasons.has(l.season))) continue;
      m.set(parlayGameKey(leg.team, l), leg.side === "over" ? l.value > leg.point : l.value < leg.point);
    }
    return m;
  });
  let shared = 0;
  let hits = 0;
  for (const [key] of maps[0] ?? new Map()) {
    if (!maps.every((m) => m.has(key))) continue;
    shared++;
    if (maps.every((m) => m.get(key))) hits++;
  }
  return { hits, shared };
}

export function findTwoTeamParlays(legs: FinderLeg[], options: Partial<FinderOptions> = {}): { size: number; parlays: TwoTeamParlay[] }[] {
  const o = { ...DEFAULT_FINDER, ...options };
  const teams = [...new Set(legs.map((l) => l.team))];
  if (teams.length !== 2) return [];
  const seasons = o.seasons ? new Set(o.seasons) : null;
  const sideResults = teams.map((team) => {
    const bySize = new Map<number, FoundParlay[]>();
    for (const r of findParlays(
      legs.filter((l) => l.team === team),
      { ...o, includeSingles: true, perSize: SIDE_PER_SIZE, maxLegs: o.maxLegs - 1 }
    ))
      bySize.set(r.size, r.parlays);
    return bySize;
  });
  const sideKey = (p: FoundParlay) => p.legs.map((l) => l.key).join("|");
  const floor = (p: FoundParlay) => rateFloor(p.hits, p.shared);

  const out: { size: number; parlays: TwoTeamParlay[] }[] = [];
  for (let size = 2; size <= o.maxLegs; size++) {
    const pairs: { a: FoundParlay; b: FoundParlay; score: number }[] = [];
    for (let k = 1; k < size; k++) {
      for (const a of sideResults[0].get(k) ?? [])
        for (const b of sideResults[1].get(size - k) ?? []) {
          if (a.hits / a.shared * (b.hits / b.shared) < o.minRate) continue;
          pairs.push({ a, b, score: floor(a) * floor(b) });
        }
    }
    pairs.sort((x, y) => y.score - x.score);
    const uses = new Map<string, number>();
    const picked: TwoTeamParlay[] = [];
    for (const { a, b } of pairs) {
      if (picked.length >= o.perSize) break;
      const ka = sideKey(a);
      const kb = sideKey(b);
      if ((uses.get(ka) ?? 0) >= PER_SIDE || (uses.get(kb) ?? 0) >= PER_SIDE) continue;
      uses.set(ka, (uses.get(ka) ?? 0) + 1);
      uses.set(kb, (uses.get(kb) ?? 0) + 1);
      const all = [...a.legs, ...b.legs];
      picked.push({
        legs: all,
        sides: [
          { team: teams[0], parlay: a },
          { team: teams[1], parlay: b },
        ],
        estimate: (a.hits / a.shared) * (b.hits / b.shared),
        h2h: headToHead(all, seasons),
        priceAmerican: parlayPrice(all),
        model: all.every((l) => l.modelProb !== null) ? all.reduce((p, l) => p * l.modelProb!, 1) : null,
      });
    }
    if (picked.length) out.push({ size, parlays: picked });
  }
  return out;
}
