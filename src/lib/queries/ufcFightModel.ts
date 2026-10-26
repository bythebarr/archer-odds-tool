/**
 * The UFC fight model (v2, lib/ufc/fightModel.ts) for one bout: the replay of
 * every earlier fight, the fitted coefficients, and the moneyline market blend.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { loadUfcHistory } from "@/lib/ufc/fightData";
import { UfcReplay, coefficientVector, fightWinProb, FEATURES, type FeatureName, type FighterProfile } from "@/lib/ufc/fightModel";
import { finalProbOver, marketRead, MIN_FIT_SAMPLES, DEFAULT_MODEL_WEIGHT, type MarketRead } from "@/lib/propModel/market";
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

/** All completed bouts replayed once per request (the bout being viewed is upcoming, so it isn't in it). */
const replayed = cache(async () => {
  const history = await loadUfcHistory();
  const replay = new UfcReplay(history.fighters, history.bouts);
  for (const b of history.bouts) replay.update(b);
  return replay;
});

async function fitted(): Promise<{ coefficients: number[] | null; beatsV1: boolean }> {
  const r = await prisma.modelReport.findFirst({ where: { model: "ufc-fights:ml" }, orderBy: { createdAt: "desc" }, select: { n: true, extra: true } });
  const e = r?.extra as { coefficients?: Record<string, number>; beatsV1?: boolean } | null | undefined;
  if (!r || r.n < MIN_FIT_SAMPLES || !e?.coefficients) return { coefficients: null, beatsV1: false };
  return { coefficients: coefficientVector(e.coefficients as Partial<Record<FeatureName, number>>), beatsV1: e.beatsV1 === true };
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
