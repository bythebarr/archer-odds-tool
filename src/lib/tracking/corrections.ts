/**
 * Grade corrections for settled leans (Phase 2 A2, audit S-7).
 *
 * PredictionSettlement rows are write-once history: settle.ts creates them
 * with skipDuplicates and nothing ever updates them, so a wrong grade (a
 * stat-key change, a box-score fix upstream) could never be repaired — the
 * diagnosis loop would learn from the corrupted grade forever. Corrections
 * are the repair path that keeps history intact: a correction is an
 * append-only SettlementCorrection row recording the previous effective
 * values, the corrected values, and a human reason. Readers resolve the
 * EFFECTIVE grade by applying the newest correction over the base row;
 * the base row is never mutated, so the audit trail shows every grade a
 * lean ever carried, in order.
 */
import { prisma } from "@/lib/prisma";
import type { SettleResult } from "./types";

/** The graded values a settlement (or a correction) carries. */
export interface SettlementValues {
  result: SettleResult;
  actual: number | null;
  closingProb: number | null;
  closingPrice: number | null;
}

/** One correction row, as the pure resolver reads it. */
export interface CorrectionLike extends SettlementValues {
  predictionId: string;
  createdAt: Date;
}

export interface EffectiveSettlement extends SettlementValues {
  predictionId: string;
  /** True when at least one correction supersedes the base grade. */
  corrected: boolean;
  /** How many corrections have been applied to this lean, in total. */
  correctionCount: number;
}

const byTime = (a: CorrectionLike, b: CorrectionLike) => a.createdAt.getTime() - b.createdAt.getTime();

/**
 * The grade evaluation should read for one lean: the base settlement with
 * its corrections applied oldest-to-newest (the newest correction wins on
 * every field — a correction restates the whole grade, never a patch).
 * Pure; corrections for other predictions are ignored.
 */
export function effectiveSettlement(
  base: SettlementValues & { predictionId: string },
  corrections: CorrectionLike[],
): EffectiveSettlement {
  const mine = corrections.filter((c) => c.predictionId === base.predictionId).sort(byTime);
  if (!mine.length) return { ...base, corrected: false, correctionCount: 0 };
  const last = mine[mine.length - 1];
  return {
    predictionId: base.predictionId,
    result: last.result,
    actual: last.actual,
    closingProb: last.closingProb,
    closingPrice: last.closingPrice,
    corrected: true,
    correctionCount: mine.length,
  };
}

/** Effective grades for a batch of settlements, corrections grouped once. Pure. */
export function applyCorrections<T extends SettlementValues & { predictionId: string }>(
  bases: T[],
  corrections: CorrectionLike[],
): (T & EffectiveSettlement)[] {
  const byPrediction = new Map<string, CorrectionLike[]>();
  for (const c of corrections) (byPrediction.get(c.predictionId) ?? byPrediction.set(c.predictionId, []).get(c.predictionId)!).push(c);
  return bases.map((b) => ({ ...b, ...effectiveSettlement(b, byPrediction.get(b.predictionId) ?? []) }));
}

const sameValues = (a: SettlementValues, b: SettlementValues) =>
  a.result === b.result && a.actual === b.actual && a.closingProb === b.closingProb && a.closingPrice === b.closingPrice;

/**
 * Append a correction for one settled lean. Validates against the CURRENT
 * effective grade (so chained corrections record the true previous values),
 * refuses a no-op correction and a missing reason, and never updates or
 * deletes the settlement or any earlier correction.
 */
export async function correctSettlement(predictionId: string, corrected: SettlementValues, reason: string) {
  if (!reason.trim()) throw new Error("a correction requires a reason");
  const base = await prisma.predictionSettlement.findUnique({ where: { predictionId } });
  if (!base) throw new Error(`no settlement exists for prediction ${predictionId}`);
  const prior = await prisma.settlementCorrection.findMany({ where: { predictionId }, orderBy: { createdAt: "asc" } });
  const current = effectiveSettlement(
    { predictionId, result: base.result as SettleResult, actual: base.actual, closingProb: base.closingProb, closingPrice: base.closingPrice },
    prior.map((c) => ({ predictionId: c.predictionId, result: c.result as SettleResult, actual: c.actual, closingProb: c.closingProb, closingPrice: c.closingPrice, createdAt: c.createdAt })),
  );
  if (sameValues(current, corrected)) throw new Error("correction changes nothing — the effective grade already matches");
  return prisma.settlementCorrection.create({
    data: {
      predictionId,
      previousResult: current.result,
      previousActual: current.actual,
      previousClosingProb: current.closingProb,
      previousClosingPrice: current.closingPrice,
      result: corrected.result,
      actual: corrected.actual,
      closingProb: corrected.closingProb,
      closingPrice: corrected.closingPrice,
      reason: reason.trim(),
    },
  });
}
