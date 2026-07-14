/**
 * The single source of truth for what sports the engine knows. Nav, slate, the
 * board, and grading dispatch all derive from this (Phase 3). Adapters land here
 * in later phases — MLB (Phase 1), UFC (Phase 2), then the rest.
 *
 * Phases 1–2: MLB + UFC are registered — the two most different sports (odds
 * model vs. fighter-math, shared Game table vs. its own UfcBout family, same-day
 * vs. late out-of-band settlement). Both self-contained; no live path routes
 * through the registry yet (board, grader, and nav still call each sport's
 * machinery directly). Registration + parity tests prove one contract fits both
 * before anything is rewired (Phase 3).
 */
import type { SportAdapter } from "./types";
import { mlbAdapter } from "./adapters/mlb";
import { ufcAdapter } from "./adapters/ufc";

export const SPORTS: SportAdapter[] = [mlbAdapter, ufcAdapter];

export const sportByKey: Map<string, SportAdapter> = new Map(
  SPORTS.map((a) => [a.key, a])
);

/** The adapter for a play's sport, or undefined if the sport isn't registered. */
export function getAdapter(sportKey: string): SportAdapter | undefined {
  return sportByKey.get(sportKey);
}
