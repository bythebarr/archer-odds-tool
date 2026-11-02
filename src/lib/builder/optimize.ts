/**
 * The payout optimizer: for the payout you want (+500, say), the combination of
 * legs most likely to cash that pays at least that much. Pure.
 *
 * Each leg brings its conservative chance (lib/builder/conservative) and its
 * price. Legs from different games are treated as independent, so a parlay's
 * chance is the product of its legs' and its payout the product of their
 * decimal prices. In logs both are sums, which makes this a knapsack: pick at
 * most one leg per game (or per market, with same-game legs allowed) so the
 * log prices reach the target's and the log chances are as large as possible.
 * It is solved exactly by dynamic programming over the log price, in steps of
 * 1% of payout, and over the number of legs.
 *
 * Alternatives: the best parlay, then the best with each of its legs left out
 * in turn, so the list shows real options rather than one stack reshuffled.
 */
import { americanToDecimal, decimalToAmerican } from "@/lib/odds/americanOdds";
import { MAX_TRUSTED_RELATIVE_EDGE, conservativeProb, relativeEdge } from "./conservative";
import { MAX_TRUSTED_EDGE } from "./build";
import type { BuilderLeg, BuilderWindow } from "./types";

export interface OptimizeOptions {
  /** Sports to draw from; empty = every sport. */
  sports: string[];
  /** The payout wanted, American (+500). The parlay pays at least this. */
  target: number;
  /** Exact leg count, or null for any count from 2 to `maxLegs`. */
  legs: number | null;
  maxLegs: number;
  /** The record window behind each leg's conservative chance. */
  window: BuilderWindow;
  sameGame: boolean;
  /** Skip legs priced shorter than this (−1000); −Infinity = any. */
  shortest: number;
  /** Skip legs whose conservative chance is below this. */
  minProb: number;
  /** Parlays returned. */
  count: number;
}

export const DEFAULT_OPTIMIZE: Omit<OptimizeOptions, "target"> = {
  sports: [],
  legs: null,
  maxLegs: 8,
  window: "l10",
  sameGame: false,
  shortest: -1000,
  minProb: 0.3,
  count: 5,
};

export interface OptimizedParlay {
  legs: (BuilderLeg & { prob: number })[];
  priceAmerican: number;
  /** The legs' conservative chances multiplied. */
  prob: number;
  /** ARCHR's chances multiplied; null when a leg has no read. */
  archr: number | null;
  /** Conservative EV at the price, as a fraction of stake. */
  edge: number;
}

/** Log-price resolution: 1% of payout. */
const STEP = 0.01;

interface Cand {
  leg: BuilderLeg;
  prob: number;
  lp: number;
  /** Price in steps of log decimal, rounded down (never overstates the payout). */
  w: number;
}

function candidates(pool: BuilderLeg[], o: OptimizeOptions): Map<string, Cand[]> {
  const groups = new Map<string, Cand[]>();
  for (const leg of pool) {
    if (leg.priceAmerican === null || leg.priceAmerican < o.shortest) continue;
    if (o.sports.length && !o.sports.includes(leg.sport)) continue;
    const prob = conservativeProb(leg.archr, leg.rates[o.window]);
    if (prob === null || prob < o.minProb || prob >= 1) continue;
    // A price far longer than the leg's cautious read is a price that doesn't belong to it: the optimizer would chase it.
    if ((leg.edge !== null && leg.edge > MAX_TRUSTED_EDGE) || (relativeEdge(prob, leg.priceAmerican) ?? 0) > MAX_TRUSTED_RELATIVE_EDGE) continue;
    const w = Math.floor(Math.log(americanToDecimal(leg.priceAmerican)) / STEP);
    if (w <= 0) continue;
    const key = o.sameGame ? `${leg.eventId}|${leg.group}` : leg.eventId;
    const list = groups.get(key) ?? [];
    list.push({ leg, prob, lp: Math.log(prob), w });
    groups.set(key, list);
  }
  // In a group only the legs on the frontier matter: none shorter-priced and likelier.
  for (const [key, list] of groups) {
    list.sort((a, b) => b.w - a.w || b.lp - a.lp);
    const frontier: Cand[] = [];
    let best = -Infinity;
    for (const c of list) {
      if (c.lp > best) {
        frontier.push(c);
        best = c.lp;
      }
    }
    groups.set(key, frontier.slice(0, 255));
  }
  return groups;
}

/** The single best parlay, or null; `banned` leg ids are left out. */
function solve(groups: Cand[][], o: OptimizeOptions, B: number, banned: Set<string>): Cand[] | null {
  const K = o.legs ?? o.maxLegs;
  const width = B + 1;
  const size = (K + 1) * width;
  const NEG = -Infinity;
  let dp = new Float64Array(size).fill(NEG);
  dp[0] = 0;
  // Per group, for each (legs, bin) it improved: which of its legs (1-based) and the bin it came from.
  const choices: Uint8Array[] = [];
  const parents: Uint16Array[] = [];
  for (const group of groups) {
    const next = Float64Array.from(dp);
    const choice = new Uint8Array(size);
    const parent = new Uint16Array(size);
    group.forEach((c, ci) => {
      if (banned.has(c.leg.id)) return;
      for (let k = K - 1; k >= 0; k--) {
        const row = k * width;
        const out = (k + 1) * width;
        for (let b = 0; b <= B; b++) {
          const v = dp[row + b];
          if (v === NEG) continue;
          const nb = Math.min(B, b + c.w);
          const nv = v + c.lp;
          if (nv > next[out + nb]) {
            next[out + nb] = nv;
            choice[out + nb] = ci + 1;
            parent[out + nb] = b;
          }
        }
      }
    });
    choices.push(choice);
    parents.push(parent);
    dp = next;
  }
  let k = -1;
  let bestV = NEG;
  for (let kk = o.legs ?? 2; kk <= K; kk++) {
    if (dp[kk * width + B] > bestV) {
      bestV = dp[kk * width + B];
      k = kk;
    }
  }
  if (k < 0) return null;
  // Walk back: a group that didn't improve a state left it as the previous group had it.
  const picked: Cand[] = [];
  let b = B;
  for (let g = groups.length - 1; g >= 0 && k > 0; g--) {
    const ci = choices[g][k * width + b];
    if (!ci) continue;
    picked.push(groups[g][ci - 1]);
    b = parents[g][k * width + b];
    k -= 1;
  }
  return k === 0 ? picked.reverse() : null;
}

function summarize(cands: Cand[]): OptimizedParlay {
  const legs = cands.map((c) => ({ ...c.leg, prob: c.prob }));
  const dec = legs.reduce((p, l) => p * americanToDecimal(l.priceAmerican!), 1);
  const prob = cands.reduce((p, c) => p * c.prob, 1);
  return {
    legs,
    priceAmerican: Math.round(decimalToAmerican(dec)),
    prob,
    archr: legs.every((l) => l.archr !== null) ? legs.reduce((p, l) => p * l.archr!, 1) : null,
    edge: prob * dec - 1,
  };
}

export function optimizeParlays(pool: BuilderLeg[], options: Partial<OptimizeOptions> & { target: number }): { candidates: number; parlays: OptimizedParlay[] } {
  const o: OptimizeOptions = { ...DEFAULT_OPTIMIZE, ...options };
  const groupMap = candidates(pool, o);
  const groups = [...groupMap.values()];
  const count = groups.reduce((n, g) => n + g.length, 0);
  const B = Math.ceil(Math.log(americanToDecimal(o.target)) / STEP);
  const best = solve(groups, o, B, new Set());
  if (!best) return { candidates: count, parlays: [] };
  const found = [best];
  for (const c of best) {
    const alt = solve(groups, o, B, new Set([c.leg.id]));
    if (alt) found.push(alt);
  }
  const seen = new Set<string>();
  const parlays = found
    .map(summarize)
    .filter((p) => {
      const key = p.legs.map((l) => l.id).sort().join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, o.count);
  return { candidates: count, parlays };
}
