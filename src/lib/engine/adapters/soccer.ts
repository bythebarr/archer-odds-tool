/**
 * Soccer adapter (thin, Phase 4 lead-in). Soccer has an odds feed
 * (pollAndStoreSoccerOdds) and a Slate presence but no ARCHR model yet — so it
 * carries NO +EV board plays. It registers here so nav/Slate/rail derive from the
 * ONE registry (Phase 3d); `listPlays` fills in when the paid-EV lens lights up.
 * Full Phase 4 also generalizes devig to the 3-way (home/draw/away) market.
 *
 * Market-lite for now: meta + a real `ingest` wrapper, an empty board, and a
 * conservative `grade`. See docs/architecture/sport-engine.md.
 */
import { pollAndStoreSoccerOdds } from "@/lib/soccer/ingest";
import { sportMetaByKey } from "../sportsMeta";
import type { IngestSummary, MarketSpec, Play, PlayGrade, SportAdapter } from "../types";

/** Soccer is 3-way (home/draw/away) plus totals; devig generalizes in full Phase 4. */
const SOCCER_MARKETS: MarketSpec[] = [
  { market: "h2h", kind: "ml", label: "1X2" },
  { market: "totals", kind: "total", label: "Total Goals" },
];

/** Pull soccer odds into the shared Game/odds tables (mirrors the soccer odds poll). */
async function ingest(): Promise<IngestSummary> {
  const summary = await pollAndStoreSoccerOdds();
  return {
    sportKey: "soccer",
    ok: true,
    detail: `${summary.matchesStored} matches, ${summary.snapshotsWritten} snapshots`,
    ...summary,
  };
}

/** No ARCHR soccer model yet → no +EV board plays. Lights up with the paid-EV lens. */
async function listPlays(): Promise<Play[]> {
  return [];
}

/** Soccer produces no tracked plays yet, so this never runs; void is the safe default. */
async function grade(): Promise<PlayGrade> {
  return "void";
}

export const soccerAdapter = {
  key: "soccer",
  meta: sportMetaByKey.soccer,
  markets: SOCCER_MARKETS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
