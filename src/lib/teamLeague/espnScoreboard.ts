/**
 * ESPN's public scoreboard — the results authority for every team league built
 * on the shared team-league pipeline (NFL, NBA), in the same role MLB Stats API
 * plays for baseball, Cito for UFC, and Jolpica for F1. Every league serves the
 * same payload shape from `/apis/site/v2/sports/{sport}/{league}/scoreboard`, so
 * one parser covers them all; only the path differs.
 *
 * Free and unkeyed, which is the point: `docs/architecture/provider-coverage.md`
 * establishes that ParlayAPI is the odds-and-props layer, not the everything
 * layer, and it serves no results we'd trust — its own event ids agree with
 * /odds on only 12 of 16 NFL games. Grading has to come from somewhere
 * authoritative or not at all.
 *
 * Verified live 2026-07-21 against a completed 2025 NFL slate: full team display
 * names matching our allowlist exactly, final scores, and an explicit per-team
 * `winner` flag. Team NAMES are the join key — never ESPN's event id against a
 * book's event id, which is the trap that lost props for a day.
 */

const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports";

export interface EspnTeamResult {
  /** ESPN's own event id — stored for debugging only, never joined against a book feed. */
  espnEventId: string;
  startUtc: Date;
  /** Full display name, e.g. "Kansas City Chiefs" — resolved through the league's team allowlist. */
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  /** True only when ESPN says the game is over; anything in progress is ignored. */
  completed: boolean;
  /** Points per period (quarters, then overtime); empty when ESPN sends none. */
  homePeriods: number[];
  awayPeriods: number[];
  /** ESPN's season type: 1 preseason, 2 regular season, 3 postseason (null when not sent). */
  seasonType: number | null;
}

/** Exhibitions: preseason (and anything ESPN files under the off-season). Never a game we count. */
export function isExhibition(r: Pick<EspnTeamResult, "seasonType">): boolean {
  return r.seasonType === 1 || r.seasonType === 4;
}

/** Minimal shape of the bits we read — ESPN sends far more than this. */
interface EspnScoreboardResponse {
  events?: {
    id?: string;
    date?: string;
    season?: { type?: number };
    competitions?: {
      status?: { type?: { completed?: boolean } };
      competitors?: {
        homeAway?: string;
        score?: string | number;
        team?: { displayName?: string };
        linescores?: { value?: number | string }[];
      }[];
    }[];
  }[];
}

/** A competitor's per-period points, or [] if any period is unreadable (never a partial line). */
function periods(lines: { value?: number | string }[] | undefined): number[] {
  const values = (lines ?? []).map((l) => Number(l.value));
  return values.every((v) => Number.isInteger(v) && v >= 0) ? values : [];
}

/** ESPN's `dates` param wants YYYYMMDD; our dates travel as ET YYYY-MM-DD. */
export function toEspnDateParam(dateEt: string): string {
  return dateEt.replace(/-/g, "");
}

/**
 * Parses one scoreboard payload into results.
 *
 * Deliberately strict, matching the tennis grader's old rationale: anything with
 * a missing team, an unparseable score, or fewer than two competitors is dropped
 * rather than guessed at. A game left ungraded one more cycle is recoverable; a
 * wrongly graded one corrupts the record permanently.
 *
 * Exported so the parsing is testable against a captured payload without a
 * network call.
 */
export function parseScoreboard(payload: unknown): EspnTeamResult[] {
  // `?.` not just `??`: a null body (an upstream error page, a truncated
  // response) must yield "no results", not throw inside the grading cron.
  const body = payload as EspnScoreboardResponse | null | undefined;
  const out: EspnTeamResult[] = [];

  for (const event of body?.events ?? []) {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    if (competitors.length !== 2) continue;

    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const homeName = home?.team?.displayName;
    const awayName = away?.team?.displayName;
    if (!homeName || !awayName) continue;

    const completed = competition?.status?.type?.completed === true;
    // A final needs real scores to grade; a game not yet played may carry none
    // (the schedule sync only needs its teams and start).
    const homeScore = Number(home?.score ?? (completed ? NaN : 0));
    const awayScore = Number(away?.score ?? (completed ? NaN : 0));
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;

    const startUtc = event.date ? new Date(event.date) : null;
    if (!startUtc || Number.isNaN(startUtc.getTime())) continue;

    out.push({
      espnEventId: event.id ?? "",
      startUtc,
      homeName,
      awayName,
      homeScore,
      awayScore,
      completed,
      homePeriods: periods(home?.linescores),
      awayPeriods: periods(away?.linescores),
      seasonType: typeof event.season?.type === "number" ? event.season.type : null,
    });
  }

  return out;
}

/**
 * Fetches one ET date's scoreboard for a league path such as "football/nfl" or
 * "basketball/nba". Throws on a non-OK response so the caller can log and retry.
 *
 * Preseason games are dropped unless asked for: they never enter the schedule,
 * results, records, models or player logs (only the preseason purge reads them).
 */
export async function fetchEspnScoreboard(path: string, dateEt: string, { includeExhibitions = false } = {}): Promise<EspnTeamResult[]> {
  const url = `${SCOREBOARD_BASE}/${path}/scoreboard?dates=${toEspnDateParam(dateEt)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN scoreboard request failed: ${res.status} ${res.statusText}`);
  }
  const results = parseScoreboard(await res.json());
  return includeExhibitions ? results : results.filter((r) => !isExhibition(r));
}
