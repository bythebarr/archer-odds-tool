/**
 * ESPN's public tennis scoreboard — the results authority tennis never had.
 *
 * ParlayAPI prices tennis but serves no tennis scores at all (see
 * docs/architecture/provider-coverage.md), which is why tennis has been
 * `signalOnly`: a sport whose plays can never settle. ESPN's site API is free,
 * unkeyed, and already our NFL results source, so it costs nothing to add.
 *
 * Verified live 2026-07-21 against Wimbledon 2026 and that week's ATP/WTA draws.
 * What it actually returns, and the traps in it:
 *
 *  - Shape is events → groupings → competitions, NOT the flat events → competitions
 *    the NFL scoreboard uses. An "event" is a whole TOURNAMENT (Wimbledon), a
 *    grouping is a draw ("mens-singles"), and a competition is one match.
 *  - `?dates=YYYYMMDD` selects which tournament(s) were running that day, then
 *    returns the ENTIRE tournament — every match from every day of it. So the
 *    caller must filter by each competition's own date; the param alone is not a
 *    day filter.
 *  - The ATP and WTA endpoints both return combined events in full: asking either
 *    for Wimbledon yields the men's AND women's draws. Fetching both tours
 *    therefore double-reports every match, so results are deduped on ESPN's
 *    competition id (used only for dedup inside this one payload set — never as a
 *    join key against a book feed).
 *  - Doubles competitors carry `athlete: null`; only singles name their players.
 *    Requiring both names is what keeps doubles out, since our odds feed is
 *    singles-only.
 *  - Statuses seen in the wild: FINAL, RETIRED, WALKOVER (all completed), plus
 *    SCHEDULED and IN_PROGRESS. Retirements are real results (the books pay them);
 *    walkovers are refunded, so they're flagged separately for the caller to push.
 *  - The per-SET `winner` flags are unreliable — a 7-6 set has been observed with
 *    `winner: false` on both players. The competitor-level `winner` flag is the
 *    one that agrees with the match notes, so that is the only winner signal used,
 *    and a match without exactly one winner is dropped rather than guessed.
 */

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/tennis";

/** Both tours are fetched every run; a combined event returns identically from either. */
export const TENNIS_TOURS = ["atp", "wta"] as const;

export interface EspnTennisResult {
  /** ESPN's competition id — dedup within this fetch only, never joined to a book feed. */
  espnCompetitionId: string;
  startUtc: Date;
  /** Player display names, e.g. "Alex de Minaur". */
  homeName: string;
  awayName: string;
  /** Sets won — see countSets for why this is approximate on a retirement. */
  homeSets: number;
  awaySets: number;
  homeWon: boolean;
  /** True for FINAL, RETIRED and WALKOVER; anything still playing is ignored. */
  completed: boolean;
  /** Never struck a ball — books refund, so this settles as a push, not a win. */
  walkover: boolean;
}

/** Minimal shape of the bits we read — ESPN sends far more than this. */
interface EspnTennisScoreboardResponse {
  events?: {
    groupings?: {
      competitions?: {
        id?: string;
        date?: string;
        status?: { type?: { name?: string; completed?: boolean } };
        competitors?: {
          homeAway?: string;
          winner?: boolean;
          linescores?: { value?: number }[];
          athlete?: { displayName?: string } | null;
        }[];
      }[];
    }[];
  }[];
}

/** ESPN's `dates` param wants YYYYMMDD; our dates travel as ET YYYY-MM-DD. */
export function toEspnDateParam(dateEt: string): string {
  return dateEt.replace(/-/g, "");
}

/**
 * Sets won, counted as "games won this set exceeded the opponent's".
 *
 * Deliberately approximate on a retirement: 2-6 7-6 4-0 ret credits the leader
 * the unfinished third set, so the line reads 2-1 where a purist would say 1-1.
 * That is acceptable because tennis grades ONLY h2h, off the competitor-level
 * `winner` flag — the set line is display, never an input to a settled record.
 * Trying to infer set completeness from a partial line would risk the opposite
 * failure: a wrong winner.
 */
export function countSets(mine: number[], theirs: number[]): number {
  let won = 0;
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
    if (mine[i] > theirs[i]) won++;
  }
  return won;
}

function linescoreValues(scores: { value?: number }[] | undefined): number[] {
  return (scores ?? []).map((s) => (typeof s.value === "number" ? s.value : Number.NaN));
}

/**
 * Parses one tour's scoreboard payload into per-match results.
 *
 * Strict on purpose, same rule as the NFL parser: a match missing a name, a
 * winner, or a second competitor is dropped rather than guessed at. A match left
 * ungraded one more cycle is recoverable; a wrongly graded one corrupts the
 * record permanently.
 *
 * Exported so parsing is testable against a captured payload without a network call.
 */
export function parseTennisScoreboard(payload: unknown): EspnTennisResult[] {
  // `?.` not just `??`: a null body (an upstream error page, a truncated
  // response) must yield "no results", not throw inside the grading cron.
  const body = payload as EspnTennisScoreboardResponse | null | undefined;
  const out: EspnTennisResult[] = [];

  for (const event of body?.events ?? []) {
    for (const grouping of event.groupings ?? []) {
      for (const competition of grouping.competitions ?? []) {
        const competitors = competition.competitors ?? [];
        if (competitors.length !== 2) continue;

        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");
        // Missing names are how doubles (athlete: null) fall out.
        const homeName = home?.athlete?.displayName;
        const awayName = away?.athlete?.displayName;
        if (!homeName || !awayName) continue;

        const startUtc = competition.date ? new Date(competition.date) : null;
        if (!startUtc || Number.isNaN(startUtc.getTime())) continue;

        // Exactly one winner, or we don't know who won and won't pretend to.
        const winners = competitors.filter((c) => c.winner === true);
        const statusName = competition.status?.type?.name ?? "";
        const completed = competition.status?.type?.completed === true;
        if (completed && winners.length !== 1) continue;

        const homeLine = linescoreValues(home?.linescores);
        const awayLine = linescoreValues(away?.linescores);

        out.push({
          espnCompetitionId: competition.id ?? "",
          startUtc,
          homeName,
          awayName,
          homeSets: countSets(homeLine, awayLine),
          awaySets: countSets(awayLine, homeLine),
          homeWon: home?.winner === true,
          completed,
          walkover: statusName === "STATUS_WALKOVER",
        });
      }
    }
  }

  return out;
}

/**
 * Fetches one ET date's tennis results across both tours, deduped.
 *
 * Throws on a non-OK response so the caller can log and retry — a silent empty
 * list here would look exactly like "no tennis today", the failure mode the
 * status line exists to catch.
 */
export async function fetchTennisScoreboard(dateEt: string): Promise<EspnTennisResult[]> {
  const byCompetitionId = new Map<string, EspnTennisResult>();

  for (const tour of TENNIS_TOURS) {
    const url = `${SCOREBOARD_URL}/${tour}/scoreboard?dates=${toEspnDateParam(dateEt)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`ESPN tennis scoreboard (${tour}) request failed: ${res.status} ${res.statusText}`);
    }
    for (const result of parseTennisScoreboard(await res.json())) {
      // A combined event comes back whole from both tours — first copy wins.
      // Falling back to the matchup itself keeps an id-less row from colliding
      // with every other id-less row under the empty-string key.
      const key =
        result.espnCompetitionId ||
        `${result.startUtc.toISOString()}|${result.awayName}|${result.homeName}`;
      if (!byCompetitionId.has(key)) byCompetitionId.set(key, result);
    }
  }

  return [...byCompetitionId.values()];
}
