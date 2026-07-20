/**
 * F1 adapter (thin, results-only). F1 rides a results feed (Jolpica), not an
 * odds/Slate feed — there are no bettable markets wired, so `meta.resultsOnly`
 * is set. That flag is how the Slate/nav split derives from the registry: F1
 * appears in nav (the /f1 page) but NOT on the odds Slate, without anyone
 * hardcoding "every sport except F1".
 *
 * It registers here so nav derives from the ONE registry (Phase 3d). `ingest`
 * wraps the season-schedule pull (the input to the "next race" card); the board
 * (`listPlays`) is empty and `grade` never runs (no bettable F1 plays). See
 * docs/architecture/sport-engine.md.
 */
import { ingestSeasonSchedule } from "@/lib/f1/ingestSchedule";
import { sportMetaByKey } from "../sportsMeta";
import type { IngestSummary, MarketSpec, Play, PlayGrade, SportAdapter } from "../types";

/** F1 has no bettable markets wired — results-only. */
const F1_MARKETS: MarketSpec[] = [];

/** Pull the season schedule (feeds the "next race" card). Season = the browsed date's year. */
async function ingest(dateEt: string): Promise<IngestSummary> {
  const season = Number(dateEt.slice(0, 4));
  const summary = await ingestSeasonSchedule(season);
  return {
    sportKey: "f1",
    ok: true,
    detail: `${summary.racesUpserted} races (${season})`,
    ...summary,
  };
}

/** Results-only — no bettable plays on the board. */
async function listPlays(): Promise<Play[]> {
  return [];
}

/** F1 produces no tracked plays, so this never runs; void is the safe default. */
async function grade(): Promise<PlayGrade> {
  return "void";
}

export const f1Adapter = {
  key: "f1",
  meta: sportMetaByKey.f1,
  markets: F1_MARKETS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
