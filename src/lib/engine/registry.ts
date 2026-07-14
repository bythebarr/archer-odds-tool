/**
 * The single source of truth for what sports the engine knows. Nav, slate, the
 * board, and grading dispatch all derive from this (Phase 3). Adapters land here
 * in later phases — MLB (Phase 1), UFC (Phase 2), then the rest.
 *
 * Phase 1: MLB is registered. The adapter is built and self-contained, but no
 * live path routes through the registry yet — the board, grader, and nav still
 * call the MLB machinery directly. Registration + the parity test prove the
 * contract fits before anything is rewired (Phase 3).
 */
import type { SportAdapter } from "./types";
import { mlbAdapter } from "./adapters/mlb";

export const SPORTS: SportAdapter[] = [mlbAdapter];

export const sportByKey: Map<string, SportAdapter> = new Map(
  SPORTS.map((a) => [a.key, a])
);

/** The adapter for a play's sport, or undefined if the sport isn't registered. */
export function getAdapter(sportKey: string): SportAdapter | undefined {
  return sportByKey.get(sportKey);
}
