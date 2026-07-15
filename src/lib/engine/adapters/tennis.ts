/**
 * Tennis adapter (thin, Phase 4 lead-in). Tennis has an odds feed
 * (pollAndStoreTennisOdds) and a Slate presence, but no ARCHR model yet — so it
 * carries NO +EV board plays. It registers here so nav, the Slate list, and the
 * sport rail all derive from the ONE registry (Phase 3d) rather than a parallel
 * literal list; `listPlays` fills in when the paid-EV odds lens lights up (the
 * Slate's `ev` seam, see queries/slate.ts).
 *
 * Deliberately market-lite: meta + a real `ingest` wrapper, an empty board, and
 * a conservative `grade` (no tracked tennis plays exist to grade). See
 * docs/architecture/sport-engine.md.
 */
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";
import { sportMetaByKey } from "../sportsMeta";
import type { IngestSummary, MarketSpec, Play, PlayGrade, SportAdapter } from "../types";

/** Tennis is head-to-head only in the feed we carry (no games/sets totals yet). */
const TENNIS_MARKETS: MarketSpec[] = [{ market: "h2h", kind: "ml", label: "Moneyline" }];

/** Pull tennis odds into the shared Game/odds tables (mirrors the poll-odds-tennis cron). */
async function ingest(): Promise<IngestSummary> {
  const summary = await pollAndStoreTennisOdds();
  return {
    sportKey: "tennis",
    ok: true,
    detail: `${summary.matchesStored} matches, ${summary.snapshotsWritten} snapshots`,
    ...summary,
  };
}

/** No ARCHR tennis model yet → no +EV board plays. Lights up with the paid-EV lens. */
async function listPlays(): Promise<Play[]> {
  return [];
}

/** Tennis produces no tracked plays yet, so this never runs; void is the safe default. */
async function grade(): Promise<PlayGrade> {
  return "void";
}

export const tennisAdapter = {
  key: "tennis",
  meta: sportMetaByKey.tennis,
  markets: TENNIS_MARKETS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
