/**
 * ESPN's public NFL scoreboard, for the research vertical slice only —
 * deliberately a SEPARATE client from `src/lib/nfl/espnScoreboard.ts`
 * (production results/grading), for the exact reason CFB's own client is
 * separate from NFL's (see `docs/architecture/CFB-V0.md`'s "Data source":
 * "given its own client rather than reused directly, because [this
 * consumer's] payload needs fields [the other] doesn't parse"). Production's
 * `parseScoreboard` only distinguishes completed vs. not-completed — this
 * page needs the full status (scheduled/live/postponed/other) to decide
 * eligibility and to display it, which means a different parser, not an
 * extension of the tested, currently-shipping one grading depends on.
 *
 * Same free, unkeyed endpoint and the same verified status-name vocabulary
 * CFB's client already established for this ESPN API family (STATUS_
 * SCHEDULED/IN_PROGRESS/HALFTIME/END_PERIOD/DELAYED/POSTPONED/CANCELED/
 * FINAL) — confirmed live against this endpoint specifically, 2026-09-21.
 */

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export type NflResearchGameStatus = "scheduled" | "live" | "final" | "postponed" | "other";

export interface NflScheduleGame {
  /** ESPN's own event id — debugging/display only, never a join key (team display names are, via `resolveNflTeamIdentity`). */
  espnEventId: string;
  startUtc: Date;
  status: NflResearchGameStatus;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
}

interface EspnNflCompetitor {
  homeAway?: string;
  score?: string | number;
  team?: { displayName?: string };
}

interface EspnNflEvent {
  id?: string;
  date?: string;
  competitions?: {
    status?: { type?: { name?: string; completed?: boolean } };
    competitors?: EspnNflCompetitor[];
  }[];
}

interface EspnScheduleResponse {
  events?: EspnNflEvent[];
}

function toStatus(name: string | undefined, completed: boolean | undefined): NflResearchGameStatus {
  if (completed) return "final";
  switch (name) {
    case "STATUS_SCHEDULED":
      return "scheduled";
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_END_PERIOD":
    case "STATUS_DELAYED":
      return "live";
    case "STATUS_POSTPONED":
    case "STATUS_CANCELED":
      return "postponed";
    case "STATUS_FINAL":
      return "final";
    default:
      return "other";
  }
}

/**
 * Parses one scoreboard payload into games. Strict, matching every other
 * ESPN parser in this codebase (CFB's, NFL production's): a missing team, an
 * unparseable score on a completed game, fewer than two competitors, a
 * missing event id, or an unparseable date drops the event rather than
 * guessing. Exported so parsing is testable against a captured payload with
 * no network call.
 */
export function parseNflSchedule(payload: unknown): NflScheduleGame[] {
  const body = payload as EspnScheduleResponse | null | undefined;
  const out: NflScheduleGame[] = [];

  for (const event of body?.events ?? []) {
    const espnEventId = event.id;
    if (!espnEventId) continue;

    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    if (competitors.length !== 2) continue;

    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const homeName = home?.team?.displayName;
    const awayName = away?.team?.displayName;
    if (!homeName || !awayName) continue;

    const startUtc = event.date ? new Date(event.date) : null;
    if (!startUtc || Number.isNaN(startUtc.getTime())) continue;

    const status = toStatus(competition?.status?.type?.name, competition?.status?.type?.completed);

    const homeRaw = home?.score;
    const awayRaw = away?.score;
    const homeScoreNum = homeRaw === undefined ? null : Number(homeRaw);
    const awayScoreNum = awayRaw === undefined ? null : Number(awayRaw);
    // A completed game with a non-numeric score is corrupt, not "no score yet" — drop it.
    if (status === "final" && (!Number.isFinite(homeScoreNum) || !Number.isFinite(awayScoreNum))) continue;

    // ESPN sends a literal "0" for both sides pregame, not an absent field —
    // report "no score yet" (null) for anything not yet underway, matching
    // CFB's identical rationale (a real 0-0 could otherwise be misread).
    const scoresApply = status !== "scheduled";

    out.push({
      espnEventId,
      startUtc,
      status,
      homeName,
      awayName,
      homeScore: scoresApply && Number.isFinite(homeScoreNum) ? homeScoreNum : null,
      awayScore: scoresApply && Number.isFinite(awayScoreNum) ? awayScoreNum : null,
    });
  }

  return out;
}

/**
 * Fetches ESPN's default NFL scoreboard response — the CURRENT week's full
 * slate (verified live: no `dates` param returns "this week," mixing
 * already-final and still-scheduled games), which is the natural unit for a
 * research board ("this week's games"), unlike CFB's day-by-day board. No
 * date-range parameter is exposed here on purpose — this slice does not
 * offer historical-week browsing (see docs/architecture/NFL-RESEARCH.md's
 * "what this does not do").
 */
export async function fetchCurrentNflSchedule(): Promise<NflScheduleGame[]> {
  const res = await fetch(SCOREBOARD_URL);
  if (!res.ok) {
    throw new Error(`ESPN NFL scoreboard request failed: ${res.status} ${res.statusText}`);
  }
  return parseNflSchedule(await res.json());
}
