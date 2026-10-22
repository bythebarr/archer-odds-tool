/**
 * Adapter factory for team leagues on the shared odds + ESPN pipeline (NFL, NBA).
 * Shaped after soccer.ts (real `ingest`, empty board) rather than mlb.ts: ship
 * the feed and line shopping before any model.
 *
 * Why these leagues are worth it while MLB's model isn't sellable: the coverage
 * audit found the US majors carrying the deepest book sets and Pinnacle on a
 * provider we already pay for. That's a line-shopping surface, which is the edge
 * that actually survived backtesting (docs/architecture/calibration.md), rather
 * than another model that loses to the close.
 */
import { pollAndStoreTeamLeagueOdds } from "@/lib/teamLeague/ingest";
import { gradeTeamLeaguePlay } from "@/lib/teamLeague/grade";
import type { TeamLeague } from "@/lib/teamLeague/league";
import { sportMetaByKey } from "../sportsMeta";
import { buildIngestSummary, classifyFetchStore, summaryForCaughtError } from "../ingestResult";
import type { IngestSummary, MarketSpec, Play, SportAdapter } from "../types";

/** Spreads and totals lead for both leagues; the moneyline is the secondary market, unlike MLB. */
const TEAM_LEAGUE_MARKETS: MarketSpec[] = [
  { market: "spreads", kind: "spread", label: "Spread" },
  { market: "totals", kind: "total", label: "Total Points" },
  { market: "h2h", kind: "ml", label: "Moneyline" },
];

export function createTeamLeagueAdapter(league: TeamLeague) {
  /**
   * Pull the league's odds into the shared Game/odds tables. `eventsFetched === 0`
   * is a legitimate empty slate (no games in the window); a nonzero fetch that
   * stores zero games (every competitor unrecognized — the exact team-name-drift
   * risk this feed carries) is "unusable", not an ordinary success.
   */
  async function ingest(): Promise<IngestSummary> {
    try {
      const summary = await pollAndStoreTeamLeagueOdds(league);
      const counts = {
        fetched: summary.eventsFetched,
        stored: summary.gamesStored,
        rejected: summary.eventsSkippedUnknownTeam,
      };
      const { status, detail } = classifyFetchStore(counts, { noun: "games" });
      return buildIngestSummary(league.sport, status, detail, counts, { ...summary });
    } catch (error) {
      return summaryForCaughtError(league.sport, error);
    }
  }

  /**
   * No board plays: no model for these leagues has been shown to beat a closing
   * line, so none prices anything real. Line shopping needs no such proof — the
   * best price IS the best price — and that's what the league pages ship.
   */
  async function listPlays(): Promise<Play[]> {
    return [];
  }

  return {
    key: league.sport,
    meta: sportMetaByKey[league.sport],
    markets: TEAM_LEAGUE_MARKETS,
    ingest,
    listPlays,
    grade: gradeTeamLeaguePlay,
  } satisfies SportAdapter;
}
