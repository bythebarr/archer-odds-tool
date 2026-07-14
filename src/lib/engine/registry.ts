/**
 * The single source of truth for what sports the engine knows. Nav, slate, the
 * board, and grading dispatch all derive from this (Phase 3). Adapters land here
 * in later phases — MLB (Phase 1), UFC (Phase 2), then the rest.
 *
 * Phase 0: intentionally empty. The shape exists with no behavior wired, so
 * nothing changes at runtime yet.
 */
import type { SportAdapter } from "./types";

export const SPORTS: SportAdapter[] = [];

export const sportByKey: Map<string, SportAdapter> = new Map(
  SPORTS.map((a) => [a.key, a])
);

/** The adapter for a play's sport, or undefined if the sport isn't registered. */
export function getAdapter(sportKey: string): SportAdapter | undefined {
  return sportByKey.get(sportKey);
}
