/**
 * THE canonical prop numbers — one source of truth for what each number on a
 * props surface IS, so no surface invents its own name or meaning (Phase 6,
 * "One Number").
 *
 * The hierarchy, in plain language:
 *
 *   PROJECTION — a projected STAT VALUE (e.g. 24.6 points). An input to the
 *     model, never a chance. Surfaces must label it as a projected line,
 *     never as a probability.
 *   ARCHR CHANCE — THE number: the blended probability that a prop side
 *     cashes, out of priceProp() (projection → distribution → calibration →
 *     injury adjustment → logit blend with the de-vigged market consensus).
 *     Every probability a surface headlines is this one, and every edge is
 *     derived from it — apart from the two deliberate,
 *     separately-graded exceptions catalogued below (HIT-RATE PROJECTION
 *     and STANDOUT CHANCE), each labeled as its own engine wherever it
 *     appears.
 *   EDGE — the expected value of the best posted price at ARCHR Chance.
 *     A derived readout of ARCHR Chance vs a price — not a second opinion.
 *   CAUTIOUS EDGE — the conservative relative edge (lib/builder/conservative):
 *     min(ARCHR Chance, Wilson floor of the recent hit record) vs the best
 *     price's vig-included implied chance. A RANKING AND FILTER SIGNAL for
 *     the screener sort and the parlay optimizer — explicitly NOT a
 *     probability estimate, and never a headline chance. It has not been
 *     graded yet; scripts/backtest-cautious-edge.ts is the head-to-head
 *     grading that will decide whether the haircut earns its keep.
 *   HIT-RATE PROJECTION — PropBoard's separate empirical-Bayes engine
 *     (lib/props/projection): a next-game hit probability regressed from the
 *     player's season record toward the field. It is NOT ARCHR Chance (no
 *     market blend, no book price) and must never be presented as the same
 *     kind of number.
 *   STANDOUT CHANCE — NBA standouts' own read (lib/nba/standouts), the
 *     deliberate exception to the ARCHR-Chance rule. Its displayed chance
 *     shrinks ARCHR Chance further toward the market's no-vig chance by a
 *     fitted keep-fraction (STANDOUT_EDGE_SHRINK, fit by
 *     backtest:nba-standouts on the standouts it replays), and the chance
 *     tracking captures for a standout is the PRE-BLEND model chance
 *     (modelProbOver), not the blend. It feeds Hottest Tonight and
 *     tracking capture, is graded by its own backtest, and must never be
 *     presented as ARCHR Chance.
 */
import { conservativeProb, relativeEdge } from "@/lib/builder/conservative";
import { edgeOf, type Rate } from "@/lib/builder/types";
import type { PricedProp } from "./price";

export type CanonicalNumberKey = "projection" | "archrChance" | "edge" | "cautiousEdge" | "hitRateProjection" | "standoutChance";

export interface CanonicalNumber {
  key: CanonicalNumberKey;
  /** The one label every surface uses for this number. */
  label: string;
  /** Compact label for tight headers. */
  shortLabel: string;
  /** What kind of thing it is — the distinction the UI must never blur. */
  kind: "stat value" | "probability" | "derived value" | "ranking signal";
  /** One plain-language sentence a surface can show verbatim. */
  blurb: string;
}

export const CANONICAL_NUMBERS: Record<CanonicalNumberKey, CanonicalNumber> = {
  projection: {
    key: "projection",
    label: "Projected line",
    shortLabel: "Proj line",
    kind: "stat value",
    blurb: "ARCHR's projected stat line for the game — a stat value (like 24.6 points), not a chance.",
  },
  archrChance: {
    key: "archrChance",
    label: "ARCHR chance",
    shortLabel: "ARCHR",
    kind: "probability",
    blurb: "ARCHR chance is the one probability: the model's projection blended with the books' no-vig consensus — the number every props edge on the page is derived from.",
  },
  edge: {
    key: "edge",
    label: "ARCHR edge",
    shortLabel: "Edge",
    kind: "derived value",
    blurb: "ARCHR edge is the expected value of the best posted price at ARCHR chance — a readout of that one chance against a price, not a second opinion.",
  },
  cautiousEdge: {
    key: "cautiousEdge",
    label: "Cautious edge",
    shortLabel: "Caut. edge",
    kind: "ranking signal",
    blurb: "Cautious edge is a ranking signal, not a probability: it re-reads ARCHR chance cautiously (the lower of ARCHR chance and the low end of the recent record's range) against the price, to sort and filter — never to quote as a chance.",
  },
  standoutChance: {
    key: "standoutChance",
    label: "Standout chance",
    shortLabel: "Standout",
    kind: "probability",
    blurb: "The standout chance is NBA standouts' own read: ARCHR chance shrunk further toward the market by a fitted keep-fraction, and graded by the standouts backtest. It is a separate engine's number \u2014 not the ARCHR chance the props surfaces headline.",
  },
  hitRateProjection: {
    key: "hitRateProjection",
    label: "Hit-rate projection",
    shortLabel: "Hit-rate proj",
    kind: "probability",
    blurb: "The hit-rate projection is a separate engine: the player's season record regressed toward the field. It is not ARCHR chance — no market blend and no book price go into it.",
  },
};

/** ARCHR Chance for a side, from the priced prop — THE probability. */
export function archrChanceOf(priced: Pick<PricedProp, "probOver" | "probUnder">, side: "over" | "under"): number {
  return side === "over" ? priced.probOver : priced.probUnder;
}

/** The model's own (pre-blend) chance for a side — shown only as a step inside the blend breakdown, never as a headline. */
export function modelChanceOf(priced: Pick<PricedProp, "modelProbOver">, side: "over" | "under"): number {
  return side === "over" ? priced.modelProbOver : 1 - priced.modelProbOver;
}

/** EDGE: expected value of a price at ARCHR Chance. Derived ONLY from ARCHR Chance. */
export function edgeFromChance(archrChance: number | null, priceAmerican: number | null): number | null {
  return edgeOf(archrChance, priceAmerican);
}

/** The cautious chance behind the cautious edge: min(ARCHR Chance, record floor). NOT a probability estimate. */
export function cautiousChance(archrChance: number | null, rate: Rate): number | null {
  return conservativeProb(archrChance, rate);
}

/** CAUTIOUS EDGE: the cautious chance vs the best price's vig-included implied chance, minus one. A ranking/filter signal. */
export function cautiousEdge(archrChance: number | null, rate: Rate, priceAmerican: number | null): number | null {
  return relativeEdge(conservativeProb(archrChance, rate), priceAmerican);
}
