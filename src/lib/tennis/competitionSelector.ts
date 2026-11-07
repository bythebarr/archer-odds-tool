/**
 * Which tennis tournaments the dedicated pipeline polls (Phase 2 D2).
 *
 * Like soccer, the pipeline froze on hand-kept constants — the two Wimbledon
 * keys — when the tournament ended in July 2026, and its poll was never in
 * the tick schedule. This pure selector generalizes the ATP→WTA fallback the
 * old resolver already had: from the provider's free sports list, take the
 * active match-odds keys per tour, at most `capPerTour` per tour (the
 * documented cost shape: each key doubles the per-poll credit cost).
 * Outright/futures keys (…_winner, has_outrights) are not match odds and are
 * excluded. Surface mapping needs no change: tennis/surface maps ~30
 * tournament keywords and falls back safely on unknown keys.
 *
 * Deliberately not wired into ingest yet: activation (wiring + a tick
 * schedule entry) spends credits and lands with Sam's go, same as soccer's.
 */
import type { SportListEntry } from "../soccer/competitionSelector";

/** Active match-odds keys for one tour, in list order. Pure helper. */
function tourKeys(sports: SportListEntry[], prefix: string, cap: number): string[] {
  if (cap <= 0) return [];
  return sports
    .filter((s) => s.active && s.key.startsWith(prefix) && !s.key.includes("_winner") && s.has_outrights !== true)
    .map((s) => s.key)
    .slice(0, cap);
}

/** ATP keys first, then WTA — the old resolver's fallback order, generalized. Pure. */
export function pickActiveTennisKeys(sports: SportListEntry[], capPerTour = 1): string[] {
  return [...tourKeys(sports, "tennis_atp_", capPerTour), ...tourKeys(sports, "tennis_wta_", capPerTour)];
}
