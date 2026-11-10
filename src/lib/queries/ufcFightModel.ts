/**
 * The UFC fight model (v2, lib/ufc/fightModel.ts) for one bout: the replay of
 * every earlier fight, the fitted coefficients, and the moneyline market blend.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { loadUfcHistory } from "@/lib/ufc/fightData";
import { UfcReplay, coefficientVector, fightWinProb, FEATURES, type FeatureName, type FighterProfile } from "@/lib/ufc/fightModel";
import { finalProbOver, marketRead, MIN_FIT_SAMPLES, DEFAULT_MODEL_WEIGHT, type MarketRead } from "@/lib/propModel/market";
import { isFitFresh } from "@/lib/engine/fitFreshness";
import type { TwoSidedQuote } from "@/lib/odds/marketValue";
import { getModelWeights } from "./modelWeights";

export interface UfcFightModelView {
  /** The model alone: red's chance. */
  modelProbRed: number;
  market: MarketRead | null;
  /** Red's chance after the market blend. */
  probRed: number;
  modelWeight: number;
  weightFitted: boolean;
  coefficientsFitted: boolean;
  /** True once the backtest has shown v2 beats fighter math v1 out of sample. */
  beatsV1: boolean;
  /** Each feature's push in logit, positive favors red, biggest first. */
  contributions: { feature: FeatureName; logit: number }[];
  red: FighterProfile;
  blue: FighterProfile;
}

/** How long one replay of the history is reused across calls (the history changes when ufc-history runs, every few hours). */
const REPLAY_TTL_MS = 5 * 60_000;
let replayMemo: { at: number; replay: Promise<UfcReplay> } | null = null;

/**
 * All completed bouts replayed (the bout being priced is upcoming, so it isn't
 * in it). Shared for REPLAY_TTL_MS across calls, not just within one render:
 * React's cache() only dedupes inside a render, so callers outside one (the
 * parlay builder's pool build, scripts) reloaded the whole UFC history once
 * per bout — a 200-second build and a flood of fighter-stat queries.
 */
const replayed = cache(async (): Promise<UfcReplay> => {
  if (!replayMemo || Date.now() - replayMemo.at > REPLAY_TTL_MS) {
    const replay = (async () => {
      const history = await loadUfcHistory();
      const r = new UfcReplay(history.fighters, history.bouts);
      for (const b of history.bouts) r.update(b);
      return r;
    })();
    replayMemo = { at: Date.now(), replay };
    // A failed load isn't kept: the next call tries again.
    replay.catch(() => {
      if (replayMemo?.replay === replay) replayMemo = null;
    });
  }
  return replayMemo.replay;
});

async function fitted(): Promise<{ coefficients: number[] | null; beatsV1: boolean }> {
  const r = await prisma.modelReport.findFirst({ where: { model: "ufc-fights:ml" }, orderBy: { createdAt: "desc" }, select: { n: true, extra: true, createdAt: true } });
  const e = r?.extra as { coefficients?: Record<string, number>; beatsV1?: boolean } | null | undefined;
  // A stale fit is no fit (Decision 9): coefficients and the beatsV1 flag
  // revert together, so v2 can never price off an expired comparison.
  if (!r || r.n < MIN_FIT_SAMPLES || !isFitFresh(r.createdAt, new Date()) || !e?.coefficients) return { coefficients: null, beatsV1: false };
  return { coefficients: coefficientVector(e.coefficients as Partial<Record<FeatureName, number>>), beatsV1: e.beatsV1 === true };
}

/**
 * The v2 pricing gate for posted plays (Decision 7). One pricing path,
 * governed by the flag: v2 prices only when a FRESH fit (the Decision-9
 * gate inside fitted()) carries coefficients AND its held-out head-to-head
 * said v2 beats v1. Anything else — no fit, stale fit, v1 holds — returns
 * null and fighter math v1 prices, exactly as the bout page headlines.
 */
export interface UfcV2Pricing {
  coefficients: number[];
}

export async function getUfcV2Pricing(): Promise<UfcV2Pricing | null> {
  const fit = await fitted();
  return fit.coefficients && fit.beatsV1 ? { coefficients: fit.coefficients } : null;
}

/**
 * v2's red-corner win probability for an upcoming bout, from the same
 * request-cached replay the bout page reads. Null when either fighter has
 * no replayed bouts — a debut rests on priors alone, and v1's low-
 * confidence rule already refuses to post those; v2 keeps the same fence.
 */
export async function ufcV2ProbRed(
  pricing: UfcV2Pricing,
  redFighterId: string,
  blueFighterId: string,
  eventDate: Date,
  weightClass: string
): Promise<number | null> {
  const replay = await replayed();
  const date = eventDate > new Date() ? eventDate : new Date();
  const { x, a, b } = replay.features(redFighterId, blueFighterId, date, weightClass);
  if (a.fights === 0 || b.fights === 0) return null;
  return fightWinProb(x, pricing.coefficients).probA;
}

export async function getUfcFightModel(boutId: string): Promise<UfcFightModelView | null> {
  const bout = await prisma.ufcBout.findUnique({
    where: { id: boutId },
    select: { redCornerFighterId: true, blueCornerFighterId: true, weightClass: true, status: true, event: { select: { eventDate: true } } },
  });
  if (!bout || bout.status === "completed") return null;
  const [replay, fit, weights, odds] = await Promise.all([
    replayed(),
    fitted(),
    getModelWeights("ufc"),
    prisma.ufcBoutOdds.findMany({ where: { boutId }, select: { bookKey: true, corner: true, priceAmerican: true } }),
  ]);
  const date = bout.event.eventDate > new Date() ? bout.event.eventDate : new Date();
  const { x, a, b } = replay.features(bout.redCornerFighterId, bout.blueCornerFighterId, date, bout.weightClass);
  const coefficients = fit.coefficients ?? coefficientVector({});
  const { probA, contributions } = fightWinProb(x, coefficients);

  const byBook = new Map<string, { red?: number; blue?: number }>();
  for (const o of odds) byBook.set(o.bookKey, { ...byBook.get(o.bookKey), [o.corner]: o.priceAmerican });
  const pairs: TwoSidedQuote[] = [...byBook].flatMap(([bookKey, p]) => (p.red !== undefined && p.blue !== undefined ? [{ bookKey, priceA: p.red, priceB: p.blue }] : []));
  const market = marketRead(pairs);
  const modelWeight = weights.ml ?? DEFAULT_MODEL_WEIGHT;

  return {
    modelProbRed: probA,
    market,
    probRed: finalProbOver(probA, market, modelWeight),
    modelWeight,
    weightFitted: weights.ml !== undefined,
    coefficientsFitted: fit.coefficients !== null,
    beatsV1: fit.beatsV1,
    contributions: contributions.filter((c) => Math.abs(c.logit) >= 0.005).sort((p, q) => Math.abs(q.logit) - Math.abs(p.logit)),
    red: a,
    blue: b,
  };
}

export { FEATURES };
