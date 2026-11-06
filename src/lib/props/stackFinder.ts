/**
 * The stack finder: you pick 2–8 players (teammates, usually), and it finds the
 * line for each of them that cashed together most often in the games they all
 * played. One leg per player, from every line the books hang on them tonight
 * (main lines and alt rungs).
 *
 * Built on the parlay finder's bit patterns (parlayFinder.ts): each leg is two
 * bitmasks over the game calendar, which games the player played and which of
 * them the leg cashed, so a stack's record is a few ANDs. The search goes
 * player by player (fewest lines first), keeping the best partial stacks at each
 * step (a beam), ranked by the low end of the record's confidence range, so 9
 * of 10 doesn't beat 28 of 30.
 *
 * Two rankings: how often the whole stack cashed, or the longest payout among
 * stacks that cashed at least `minRate` (which keeps the "over 0.5 points on
 * everyone" stacks from crowding out the interesting ones).
 *
 * Past joint hits describe, they don't forecast: ARCHR's chance sits beside the
 * record for that reason. Pure.
 */
import { and, parlayPrice, popcount, rateFloor, words, type Bits, type FinderLeg, type FoundParlay } from "./parlayFinder";
import { parlayGameKey } from "./parlay";

export type StackRank = "rate" | "payout";

export interface StackOptions {
  /** Only these seasons' games (all when omitted). */
  seasons?: number[];
  /** Games all the players must have played together for a stack to count. */
  minShared: number;
  rank: StackRank;
  /** Payout ranking: a stack must have cashed at least this often (0–1). */
  minRate: number;
  /** Stacks kept at each step of the search, and returned. */
  beam: number;
  count: number;
}

export const DEFAULT_STACK: StackOptions = { minShared: 5, rank: "rate", minRate: 0.7, beam: 400, count: 10 };

/** Lines tried per player: his strongest on their own. */
const PER_PLAYER = 60;

export interface StackResult {
  /** Games every picked player played (with a value for some stat). */
  together: number;
  stacks: FoundParlay[];
}

interface State {
  idx: number[];
  played: Bits;
  hit: Bits;
  shared: number;
  hits: number;
  score: number;
}

export function findStacks(allLegs: FinderLeg[], players: string[], options: Partial<StackOptions> = {}): StackResult {
  const o = { ...DEFAULT_STACK, ...options };
  const picked = new Set(players);
  const legs = allLegs.filter((l) => picked.has(l.player));
  const seasons = o.seasons ? new Set(o.seasons) : null;

  // The game calendar, newest first.
  const dateOf = new Map<string, string>();
  for (const leg of legs)
    for (const l of leg.logs) {
      if (l.value === null || (seasons && !seasons.has(l.season))) continue;
      dateOf.set(parlayGameKey(leg.team, l), l.date);
    }
  const keys = [...dateOf.keys()].sort((a, b) => dateOf.get(b)!.localeCompare(dateOf.get(a)!));
  const index = new Map(keys.map((k, i) => [k, i]));
  const W = Math.max(1, words(keys.length));

  const played: Bits[] = [];
  const hit: Bits[] = [];
  const byPlayer = new Map<string, number[]>();
  const playerPlayed = new Map<string, Bits>();
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
    (byPlayer.get(leg.player) ?? byPlayer.set(leg.player, []).get(leg.player)!).push(li);
    const pp = playerPlayed.get(leg.player) ?? new Uint32Array(W);
    for (let w = 0; w < W; w++) pp[w] |= p[w];
    playerPlayed.set(leg.player, pp);
  });

  // Games they all played.
  let all: Bits | null = null;
  for (const id of players) {
    const pp = playerPlayed.get(id);
    if (!pp) return { together: 0, stacks: [] };
    all = all ? and(all, pp) : pp;
  }
  const together = all ? popcount(all) : 0;
  if (players.length < 2 || together < o.minShared) return { together, stacks: [] };

  // Each player's strongest lines in the games they all played; fewest lines searched first.
  const order = players
    .map((id) => {
      const list = (byPlayer.get(id) ?? [])
        .map((i) => ({ i, floor: rateFloor(popcount(and(hit[i], all!)), popcount(and(played[i], all!))) }))
        .sort((a, b) => b.floor - a.floor)
        .slice(0, PER_PLAYER)
        .map((x) => x.i);
      return { id, list };
    })
    .sort((a, b) => a.list.length - b.list.length);

  const full = new Uint32Array(W).fill(0xffffffff);
  let beam: State[] = [{ idx: [], played: full, hit: full, shared: 0, hits: 0, score: 0 }];
  for (const { list } of order) {
    const next: State[] = [];
    for (const s of beam) {
      for (const i of list) {
        const p = and(s.played, played[i]);
        const shared = popcount(p);
        if (shared < o.minShared) continue;
        const h = and(and(s.hit, hit[i]), p);
        const hits = popcount(h);
        next.push({ idx: [...s.idx, i], played: p, hit: h, shared, hits, score: rateFloor(hits, shared) });
      }
    }
    if (!next.length) return { together, stacks: [] };
    next.sort((a, b) => b.score - a.score || b.shared - a.shared);
    // The payout ranking needs room for longer-priced lines further down.
    beam = next.slice(0, o.rank === "payout" ? o.beam * 3 : o.beam);
  }

  const result = (s: State): FoundParlay => {
    const chosen = s.idx.map((i) => legs[i]);
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

  let ranked = beam;
  if (o.rank === "payout") {
    const price = (s: State) => parlayPrice(s.idx.map((i) => legs[i]));
    ranked = beam
      .filter((s) => s.hits / s.shared >= o.minRate && price(s) !== null)
      .sort((a, b) => price(b)! - price(a)! || b.score - a.score);
  }
  // In player order as picked, for the card.
  const pos = new Map(players.map((id, i) => [id, i]));
  return {
    together,
    stacks: ranked.slice(0, o.count).map((s) => {
      const r = result(s);
      const order = r.legs.map((l, i) => ({ l, h: r.legHits[i] })).sort((a, b) => pos.get(a.l.player)! - pos.get(b.l.player)!);
      return { ...r, legs: order.map((x) => x.l), legHits: order.map((x) => x.h) };
    }),
  };
}
