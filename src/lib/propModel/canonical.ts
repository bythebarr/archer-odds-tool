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
 *     derived from it and nothing else.
 *   EDGE — the expected value of the best posted price at ARCHR Chance.
 *     A derived readout of ARCHR Chance vs a price — not a second opinion.
 *   CAUTIOUS EDGE — the cautious read (lib/propModel/cautiousRead) vs the
 *     best price's vig-included implied chance, minus one. A RANKING AND
 *     FILTER SIGNAL for the screener sort and the parlay optimizer —
 *     explicitly NOT a probability estimate, and never a headline chance.
 *     Two reads exist behind one interface, picked by CAUTIOUS_READ_MODE:
 *       - "legacy-min": min(ARCHR Chance, Wilson floor of the recent hit
 *         record) — the live read until the evidence gate says otherwise;
 *       - "evidence": the record as a Beta update on ARCHR Chance (worth
 *         EVIDENCE_PRIOR_GAMES pseudo-games), each record game weighted by
 *         how closely its minutes and role match tonight's (NBA).
 *     scripts/backtest-cautious-edge.ts grades both against the blend; the
 *     flag flips to "evidence" only on its say-so (evidenceGate).
 *   HIT-RATE PROJECTION — PropBoard's separate empirical-Bayes engine
 *     (lib/props/projection): a next-game hit probability regressed from the
 *     player's season record toward the field. It is NOT ARCHR Chance (no
 *     market blend, no book price) and must never be presented as the same
 *     kind of number.
 */
import { relativeEdge } from "@/lib/builder/conservative";
import { edgeOf, type Rate } from "@/lib/builder/types";
import type { PricedProp } from "./price";
import { EVIDENCE_PRIOR_GAMES, evidenceCautiousChance, legacyCautiousChance } from "./cautiousRead";

export type CautiousReadMode = "legacy-min" | "evidence";

/**
 * Which cautious read the screener sort and the parlay optimizer use. Stays
 * "legacy-min" until scripts/backtest-cautious-edge.ts shows the evidence read
 * calibrating at least as well as ARCHR Chance alone and better than the old
 * min() (lib/propModel/cautiousGrade evidenceGate). Flipping it is a one-line,
 * reviewed change, deliberately not an environment toggle: every surface and
 * every server render must read the same number.
 */
export const CAUTIOUS_READ_MODE: CautiousReadMode = "legacy-min";

/** Plain-language math of each cautious read, for explainer copy: every surface describes the read that is actually live. */
export const CAUTIOUS_READ_MATH: Record<CautiousReadMode, string> = {
  "legacy-min": "the lower of ARCHR chance and the low end of the player's recent record at this line (one standard error)",
  evidence: `ARCHR chance updated by the player's recent record at this line, the record counting as evidence by its games against ${EVIDENCE_PRIOR_GAMES} for ARCHR chance (3 games barely move it, ${EVIDENCE_PRIOR_GAMES} move it halfway, up or down), each past game weighted by how closely his minutes and role then match tonight's`,
};

/** The live cautious read's math, in words. */
export const cautiousReadMath = CAUTIOUS_READ_MATH[CAUTIOUS_READ_MODE];

export type CanonicalNumberKey = "projection" | "archrChance" | "edge" | "cautiousEdge" | "hitRateProjection";

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
    blurb: "ARCHR chance is the one probability: the model's projection blended with the books' no-vig consensus — the number every edge on the page is derived from.",
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
    label: "Cautious edge — ranking only",
    shortLabel: "Caut. edge",
    kind: "ranking signal",
    blurb: `Cautious edge — ranking only, not a probability: ${cautiousReadMath}, over the chance the price implies, minus one. It sorts and filters; it is never quoted as a chance.`,
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

/**
 * The cautious read behind the cautious edge. NOT a probability estimate.
 * `rate` is the plain record; `roleRate` the same window weighted by role
 * resemblance (NBA), read only by the evidence mode. The legacy mode ignores
 * it, so its numbers are exactly the old ones.
 */
export function cautiousChance(archrChance: number | null, rate: Rate, roleRate?: Rate | null, mode: CautiousReadMode = CAUTIOUS_READ_MODE): number | null {
  return mode === "evidence" ? evidenceCautiousChance(archrChance, roleRate ?? rate) : legacyCautiousChance(archrChance, rate);
}

/** CAUTIOUS EDGE: the cautious read vs the best price's vig-included implied chance, minus one. A ranking/filter signal. */
export function cautiousEdge(
  archrChance: number | null,
  rate: Rate,
  priceAmerican: number | null,
  roleRate?: Rate | null,
  mode: CautiousReadMode = CAUTIOUS_READ_MODE
): number | null {
  return relativeEdge(cautiousChance(archrChance, rate, roleRate, mode), priceAmerican);
}
