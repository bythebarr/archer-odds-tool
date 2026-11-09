import { NHL_LEAGUE } from "../../nhl/league";
import { createTeamLeagueAdapter } from "./teamLeague";

/**
 * NHL: full line-shopping parity with NBA/NFL from day one — the paid poll,
 * the free ESPN odds loop, results grading, freshness, tracking capture stays
 * NBA/NFL-typed for now (a deliberate, documented gap; see the Phase 5
 * backlog). What NHL does NOT have yet is an ARCHR game model: there are no
 * ratings constants to invent, so the game page is lines-only and /models
 * carries no NHL report card until a goals model exists and earns one through
 * the calibration backtest — a card written from nothing would be borrowed
 * credibility. Trust reads already fail safe: trustVerdict("nhl") has no
 * registry entry, so every NHL surface reads unproven by construction.
 */
export const nhlAdapter = createTeamLeagueAdapter(NHL_LEAGUE);
