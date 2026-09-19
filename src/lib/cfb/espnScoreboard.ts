/**
 * ESPN's public college-football scoreboard — free, unkeyed, read-only. Same
 * role and same provider as NFL's results authority (see nfl/espnScoreboard.ts),
 * but CFB gets its own client rather than reusing NFL's: CFB's payload carries
 * fields NFL's doesn't need (neutral-site, team records, richer status detail)
 * and — critically — CFB is NOT run through NFL's team allowlist. NFL keys off
 * a hardcoded 32-team roster because ParlayAPI's feed leaks CFL games into it;
 * that problem doesn't exist here, and a ~130-team FBS allowlist would rot
 * immediately. ESPN's own numeric team id is the join key instead.
 *
 * `groups=80` is ESPN's own FBS group filter — verified live 2026-07-xx against
 * a real slate (71 games on a Saturday, 86 in a completed week), giving full
 * team names, per-team overall records, neutral-site flags, and explicit
 * final scores with a `winner` flag, the same verification bar NFL's client
 * documents.
 */

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

/** ESPN's FBS group id — scopes every fetch below to major-college football. */
const FBS_GROUP = "80";

import type { CfbGameStatus, CfbScheduleGame, CfbTeamRef, CfbCompletedGame } from "./types";

/** Minimal shape of the bits we read — ESPN sends far more than this. */
interface EspnCfbCompetitor {
  homeAway?: string;
  score?: string | number;
  winner?: boolean;
  team?: { id?: string; displayName?: string; abbreviation?: string };
  records?: { type?: string; summary?: string }[];
}

interface EspnCfbEvent {
  id?: string;
  date?: string;
  competitions?: {
    neutralSite?: boolean;
    status?: { type?: { name?: string; completed?: boolean } };
    competitors?: EspnCfbCompetitor[];
  }[];
}

interface EspnScoreboardResponse {
  events?: EspnCfbEvent[];
}

const ET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Our dates travel as ET YYYY-MM-DD; ESPN's `dates` param wants YYYYMMDD.
 * Validates the shape first (defense in depth — every caller today already
 * validates before this point, but this is the boundary that actually builds
 * the request URL, so it can't just trust that): a malformed string could
 * otherwise inject arbitrary characters into the query string. The host is
 * always the hardcoded `SCOREBOARD_URL` constant regardless, so this is about
 * request integrity, not an open-redirect risk.
 */
export function toEspnDateParam(dateEt: string): string {
  if (!ET_DATE_RE.test(dateEt)) {
    throw new Error(`Invalid CFB date "${dateEt}" — expected YYYY-MM-DD`);
  }
  return dateEt.replace(/-/g, "");
}

/** Maps ESPN's status.type.name into the four states the task asks to distinguish, plus a safety bucket. */
function toGameStatus(name: string | undefined, completed: boolean | undefined): CfbGameStatus {
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
 * A completed game's score, in absolute terms, beyond which it's more likely
 * a data glitch than a real result (the modern FBS single-game scoring
 * record is in the low 90s — 120 is a generous, documented ceiling). Rejected
 * here, at parse time, so one bad number can never reach the rating solver
 * and dominate a team's rating unnoticed — same shared threshold documented
 * in `ratings.ts`.
 */
const MAX_PLAUSIBLE_SCORE = 120;

function overallRecord(records: EspnCfbCompetitor["records"]): string | null {
  const overall = records?.find((r) => r.type === "total" || r.type === "record");
  return overall?.summary ?? null;
}

function toTeamRef(c: EspnCfbCompetitor | undefined): CfbTeamRef | null {
  const id = c?.team?.id;
  const displayName = c?.team?.displayName;
  if (!id || !displayName) return null;
  return {
    espnTeamId: id,
    displayName,
    abbreviation: c?.team?.abbreviation ?? null,
    record: overallRecord(c?.records),
  };
}

/**
 * Parses one scoreboard payload into games. Deliberately strict — matching
 * NFL's and tennis's grading rationale: anything with a missing team, an
 * unparseable score on a completed game, fewer than two competitors, a
 * missing/empty event id, or an unparseable date is dropped rather than
 * guessed at. Exported so parsing is testable against captured payloads with
 * zero network calls.
 */
export function parseScoreboard(payload: unknown): CfbScheduleGame[] {
  const body = payload as EspnScoreboardResponse | null | undefined;
  const out: CfbScheduleGame[] = [];

  for (const event of body?.events ?? []) {
    // The event id is the identity every downstream layer keys off: React
    // list keys, ratings dedup, and the localStorage manual-market store.
    // Falling back to "" here (as an earlier version did) would let every
    // id-less event on a slate collide on that same empty-string key —
    // silently dropping games as "duplicates" and letting one game's manual
    // market entry bleed onto another's. Reject instead.
    const espnEventId = event.id;
    if (!espnEventId) continue;

    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    if (competitors.length !== 2) continue;

    const home = toTeamRef(competitors.find((c) => c.homeAway === "home"));
    const away = toTeamRef(competitors.find((c) => c.homeAway === "away"));
    if (!home || !away) continue;

    const startUtc = event.date ? new Date(event.date) : null;
    if (!startUtc || Number.isNaN(startUtc.getTime())) continue;

    const status = toGameStatus(competition?.status?.type?.name, competition?.status?.type?.completed);

    const homeRaw = competitors.find((c) => c.homeAway === "home")?.score;
    const awayRaw = competitors.find((c) => c.homeAway === "away")?.score;
    const homeScoreNum = homeRaw === undefined ? null : Number(homeRaw);
    const awayScoreNum = awayRaw === undefined ? null : Number(awayRaw);

    // A completed game with a non-numeric score is corrupt data, not "no score yet" — reject the event.
    if (status === "final" && (!Number.isFinite(homeScoreNum) || !Number.isFinite(awayScoreNum))) continue;

    // A completed game with an implausibly large score is more likely a feed
    // glitch than a real result — reject rather than let it silently dominate
    // a team's rating (see MAX_PLAUSIBLE_SCORE above).
    if (
      status === "final" &&
      ((homeScoreNum as number) > MAX_PLAUSIBLE_SCORE || (awayScoreNum as number) > MAX_PLAUSIBLE_SCORE)
    ) {
      continue;
    }

    // ESPN sends a literal "0" for both sides before kickoff, not an absent
    // field — report that as "no score yet" (null) rather than a real 0-0,
    // which would otherwise misread as a live/final score of 0-0.
    const scoresApply = status !== "scheduled";

    out.push({
      espnEventId,
      startUtc,
      status,
      neutralSite: competition?.neutralSite === true,
      home,
      away,
      homeScore: scoresApply && Number.isFinite(homeScoreNum) ? homeScoreNum : null,
      awayScore: scoresApply && Number.isFinite(awayScoreNum) ? awayScoreNum : null,
    });
  }

  return out;
}

/** Narrows a parsed slate to the finished games the rating model can learn from. */
export function toCompletedGames(games: CfbScheduleGame[]): CfbCompletedGame[] {
  return games
    .filter((g) => g.status === "final" && g.homeScore !== null && g.awayScore !== null)
    .map((g) => ({
      espnEventId: g.espnEventId,
      startUtc: g.startUtc,
      neutralSite: g.neutralSite,
      homeTeamId: g.home.espnTeamId,
      awayTeamId: g.away.espnTeamId,
      homeScore: g.homeScore as number,
      awayScore: g.awayScore as number,
    }));
}

// Small in-memory TTL cache: there's no DB/cron keeping CFB data fresh (v0 is
// deliberately DB-free), so without this, computing a slate's ratings would
// re-fetch every week of the season on every page load. Resets on cold start
// in a serverless deployment — a documented v0 limitation, not a correctness
// issue (a cold start just means the next request re-fetches).
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Caps the cache's memory footprint in a long-lived process — a full season is at most ~16 week-keys plus however many distinct dates get browsed; this is a generous ceiling, not a tuned value. Cache keys are full request URLs, so every parameter that affects the response (date, season, week, seasontype) is already part of the key — no risk of a stale response for a different query. */
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; games: CfbScheduleGame[] }>();

async function fetchScoreboard(url: string): Promise<CfbScheduleGame[]> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.games;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN CFB scoreboard request failed: ${res.status} ${res.statusText}`);
  }
  const games = parseScoreboard(await res.json());

  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the single oldest entry rather than let the cache grow without
    // bound in a long-lived server process — Map iteration order is insertion
    // order, so the first key is the oldest.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(url, { at: Date.now(), games });
  return games;
}

/** Fetches one ET date's full FBS slate — the board's daily view. */
export async function fetchCfbDateSlate(dateEt: string): Promise<CfbScheduleGame[]> {
  const url = `${SCOREBOARD_URL}?dates=${toEspnDateParam(dateEt)}&groups=${FBS_GROUP}&limit=400`;
  return fetchScoreboard(url);
}

/** Fetches one specific week's full FBS slate. `seasontype`: 2 = regular season, 3 = postseason. */
export async function fetchCfbWeek(season: number, week: number, seasontype: 2 | 3 = 2): Promise<CfbScheduleGame[]> {
  if (!Number.isInteger(season) || season < 1900 || season > 2200) {
    throw new Error(`Invalid CFB season "${season}"`);
  }
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    throw new Error(`Invalid CFB week "${week}"`);
  }
  const url = `${SCOREBOARD_URL}?year=${season}&week=${week}&seasontype=${seasontype}&groups=${FBS_GROUP}&limit=400`;
  return fetchScoreboard(url);
}

/** Regular-season weeks are fetched sequentially up to this cap, well past a full CFB regular season (max ~15). */
const MAX_REGULAR_SEASON_WEEKS = 16;

/**
 * Every completed FBS game in `season` strictly before `asOfUtc`, gathered week
 * by week (regular season only — `seasontype=2`; postseason/bowl results
 * never enter v0's ratings, a deliberate simplification documented in
 * CFB-V0.md). Stops fetching once a week's own games all start on/after
 * `asOfUtc` (no point fetching future weeks) or once a week comes back empty
 * (season not that far along yet). Sequential, not parallel, to stay a good
 * citizen of a free unauthenticated endpoint.
 *
 * Deduplicates by ESPN event id across weeks (defense in depth — a game
 * shouldn't legitimately appear in two different week numbers, but
 * `buildTeamRatings` also dedupes independently, so this is belt-and-suspenders,
 * not the only guard).
 */
export async function fetchCfbSeasonThrough(season: number, asOfUtc: Date): Promise<CfbCompletedGame[]> {
  const out: CfbCompletedGame[] = [];
  const seenEventIds = new Set<string>();

  for (let week = 1; week <= MAX_REGULAR_SEASON_WEEKS; week++) {
    const games = await fetchCfbWeek(season, week, 2);
    if (games.length === 0) break;

    const earliestStart = Math.min(...games.map((g) => g.startUtc.getTime()));
    for (const g of toCompletedGames(games)) {
      if (g.startUtc.getTime() >= asOfUtc.getTime()) continue;
      if (seenEventIds.has(g.espnEventId)) continue;
      seenEventIds.add(g.espnEventId);
      out.push(g);
    }

    if (earliestStart >= asOfUtc.getTime()) break;
  }

  return out;
}
