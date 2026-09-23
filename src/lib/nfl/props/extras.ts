/**
 * v1.3 prop markets built on top of the frozen v1.2 model. Pure.
 *
 * - **Rush + receiving yards** and **pass + rush yards**: the mean is the sum
 *   of the existing marginal projections. The distribution is NOT the sum of
 *   marginals: its own empirical ratio distribution, fit on the combined
 *   stat, so it carries the real correlation between the parts.
 * - **Interceptions thrown**: Poisson with λ = projected attempts ×
 *   shrunk INT rate × opponent INT factor.
 * - **2+ touchdowns**: the anytime-TD Poisson rate at ≥2, with its own
 *   calibration.
 */
import type { Snapshot } from "./engine";

export const EXTRA_MARKETS = ["rushRecYards", "passRushYards", "interceptions", "twoPlusTds"] as const;
export type ExtraMarket = (typeof EXTRA_MARKETS)[number];

export function isExtraMarket(m: string): m is ExtraMarket {
  return (EXTRA_MARKETS as readonly string[]).includes(m);
}

export interface IntParams {
  /** Prior strength for a QB's INT rate, in phantom attempts. */
  kInt: number;
  /** Prior strength for a defense's INT rate, in phantom attempts faced. */
  kDefInt: number;
  /** Damping on the opponent factor (0 = ignore the defense). */
  gammaInt: number;
}

export function intRate(eff: Snapshot, p: IntParams): number {
  return (eff.player.int + p.kInt * eff.league.intRate) / (eff.player.att + p.kInt);
}

export function oppIntFactor(def: Snapshot, p: IntParams): number {
  const lg = def.league.intRate;
  const ratio = (def.oppDef.passInt + p.kDefInt * lg) / (def.oppDef.passAtt + p.kDefInt) / lg;
  return 1 + p.gammaInt * (ratio - 1);
}

export function interceptionLambda(attempts: number, eff: Snapshot, def: Snapshot, p: IntParams): number {
  return attempts * intRate(eff, p) * oppIntFactor(def, p);
}
