/**
 * The single source of truth for what sports the engine knows. Nav, the Slate,
 * the board, and grading dispatch ALL derive from this list (Phase 3d) — there
 * are no parallel sport literals left to drift out of sync.
 *
 * MLB + UFC are the full adapters (odds model / fighter-math, with a live board
 * and grader). Tennis, soccer, and F1 register as thin market/results-lite
 * adapters: real `meta` and `ingest`, but an empty board until their paid-EV
 * lens (tennis/soccer) lands — F1 is results-only (`meta.resultsOnly`). Adding a
 * sport is a single push here; see docs/architecture/sport-engine.md.
 */
import type { SportAdapter } from "./types";
import { mlbAdapter } from "./adapters/mlb";
import { ufcAdapter } from "./adapters/ufc";
import { tennisAdapter } from "./adapters/tennis";
import { soccerAdapter } from "./adapters/soccer";
import { f1Adapter } from "./adapters/f1";

// Display order (MLB primary first): nav, the Home launcher, and the rail all
// render in registry order. Each adapter's `meta` points at the client-safe
// SPORT_METAS entry, so identity/display and behavior share one source without
// forcing this server-only module (prisma, ingest) into the client bundle.
export const SPORTS: SportAdapter[] = [mlbAdapter, ufcAdapter, tennisAdapter, soccerAdapter, f1Adapter];

// The sport-key unions derive from the client-safe meta list (see sportsMeta.ts);
// re-exported here so `@/lib/engine` stays the one import for engine types.
export type { SportKey, SlateSport, NavSport } from "./sportsMeta";

export const sportByKey: Map<string, SportAdapter> = new Map(
  SPORTS.map((a) => [a.key, a])
);

/** The adapter for a play's sport, or undefined if the sport isn't registered. */
export function getAdapter(sportKey: string): SportAdapter | undefined {
  return sportByKey.get(sportKey);
}
