/**
 * nflverse play-by-play loader for offline research scripts — never imported by
 * an app route. Downloads one season's `play_by_play_<season>.csv.gz` from the
 * free `nflverse/nflverse-data` `pbp` release, records its SHA-256 in a local
 * manifest (nflverse silently re-publishes historical seasons — 2020/2024/2025
 * were all re-released in Aug 2026 — so an experiment must be able to say
 * exactly which bytes it ran on), then stream-parses only the allow-listed
 * columns into `NflPlay` records and caches that reduced form as JSON.
 *
 * Cache layout (gitignored): `.cache/nflverse/pbp/`
 *   play_by_play_<season>.csv.gz   raw download, kept for re-derivation
 *   plays_v<N>_<season>.json       reduced, allow-listed plays
 *   manifest.json                  { [file]: { sha256, bytes, downloadedAt } }
 *
 * Set `NFLVERSE_REFRESH=1` to re-download (e.g. the in-progress season).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NFLVERSE_CACHE_DIR, downloadReleaseAsset, readManifest, streamCsv, type ManifestEntry } from "../nflverse";
import { franchise } from "./franchise";
import type { NflPlay } from "./types";

/** Bump when `NflPlay`'s shape or the allow-list changes, so stale reduced caches are ignored. */
const REDUCED_VERSION = 1;

export const PBP_CACHE_DIR = path.join(NFLVERSE_CACHE_DIR, "pbp");

/**
 * The only pbp columns this layer ever reads. `result`, `total`, `spread_line`,
 * `total_line`, `vegas_wp`, `vegas_home_wp` are intentionally absent — see
 * `types.ts`. Exported so a test can assert that stays true.
 */
export const PBP_ALLOWED_COLUMNS = [
  "game_id", "season", "week", "season_type", "game_date", "posteam", "defteam", "home_team",
  "pass", "rush", "qb_dropback", "qb_scramble", "down", "ydstogo", "yardline_100", "qtr",
  "half_seconds_remaining", "wp", "score_differential", "epa", "success", "yards_gained",
  "sack", "qb_hit", "interception", "fumble_lost", "touchdown", "complete_pass", "qb_kneel",
  "qb_spike", "two_point_attempt", "xpass", "air_yards", "passer_player_id",
  "passer_player_name", "rusher_player_id", "rusher_player_name", "receiver_player_id",
  "receiver_player_name", "passing_yards", "rushing_yards", "receiving_yards",
] as const;

export const PBP_FORBIDDEN_COLUMNS = ["result", "total", "spread_line", "total_line", "vegas_wp", "vegas_home_wp"] as const;

type Col = (typeof PBP_ALLOWED_COLUMNS)[number];

export function readPbpManifest(): Record<string, ManifestEntry> {
  return readManifest("pbp");
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = (v: string | undefined): boolean => v === "1" || v === "1.0" || v === "TRUE";
const str = (v: string | undefined): string | null => (v === undefined || v === "" || v === "NA" ? null : v);

/** Build one `NflPlay` from a raw row via the allow-list index; returns null for non-scrimmage rows. Exported for tests. */
export function toPlay(get: (c: Col) => string | undefined): NflPlay | null {
  const pass = flag(get("pass"));
  const rush = flag(get("rush"));
  const posteam = str(get("posteam"));
  const defteam = str(get("defteam"));
  if ((!pass && !rush) || !posteam || !defteam) return null;
  return {
    gameId: get("game_id") ?? "",
    season: num(get("season")) ?? 0,
    week: num(get("week")) ?? 0,
    seasonType: get("season_type") ?? "",
    gameDate: get("game_date") ?? "",
    posteam: franchise(posteam),
    defteam: franchise(defteam),
    homeTeam: franchise(get("home_team") ?? ""),
    pass,
    rush,
    qbDropback: flag(get("qb_dropback")),
    qbScramble: flag(get("qb_scramble")),
    down: num(get("down")),
    ydstogo: num(get("ydstogo")),
    yardline100: num(get("yardline_100")),
    qtr: num(get("qtr")) ?? 0,
    halfSecondsRemaining: num(get("half_seconds_remaining")),
    wp: num(get("wp")),
    scoreDifferential: num(get("score_differential")),
    epa: num(get("epa")),
    success: flag(get("success")),
    yardsGained: num(get("yards_gained")),
    sack: flag(get("sack")),
    qbHit: flag(get("qb_hit")),
    interception: flag(get("interception")),
    fumbleLost: flag(get("fumble_lost")),
    touchdown: flag(get("touchdown")),
    completePass: flag(get("complete_pass")),
    qbKneel: flag(get("qb_kneel")),
    qbSpike: flag(get("qb_spike")),
    twoPointAttempt: flag(get("two_point_attempt")),
    xpass: num(get("xpass")),
    airYards: num(get("air_yards")),
    passerId: str(get("passer_player_id")),
    passerName: str(get("passer_player_name")),
    rusherId: str(get("rusher_player_id")),
    rusherName: str(get("rusher_player_name")),
    receiverId: str(get("receiver_player_id")),
    receiverName: str(get("receiver_player_name")),
    passingYards: num(get("passing_yards")),
    rushingYards: num(get("rushing_yards")),
    receivingYards: num(get("receiving_yards")),
  };
}

async function parseSeason(gzPath: string): Promise<NflPlay[]> {
  const plays: NflPlay[] = [];
  const allowed = new Set<string>(PBP_ALLOWED_COLUMNS);
  await streamCsv(gzPath, (get) => {
    const play = toPlay((c) => (allowed.has(c) ? get(c) : undefined));
    if (play) plays.push(play);
  });
  return plays;
}

/** Load one season's scrimmage plays, downloading and reducing on first use. */
export async function loadSeasonPlays(season: number): Promise<NflPlay[]> {
  const reduced = path.join(PBP_CACHE_DIR, `plays_v${REDUCED_VERSION}_${season}.json`);
  if (existsSync(reduced) && process.env.NFLVERSE_REFRESH !== "1") {
    return JSON.parse(readFileSync(reduced, "utf8")) as NflPlay[];
  }
  const gz = await downloadReleaseAsset("pbp", `play_by_play_${season}.csv.gz`);
  if (!gz) throw new Error(`nflverse pbp ${season}: not published`);
  const plays = await parseSeason(gz);
  writeFileSync(reduced, JSON.stringify(plays));
  return plays;
}

/** Load a contiguous season range, in order. */
export async function loadPlays(fromSeason: number, toSeason: number, log?: (msg: string) => void): Promise<NflPlay[]> {
  const out: NflPlay[] = [];
  for (let s = fromSeason; s <= toSeason; s++) {
    const plays = await loadSeasonPlays(s);
    log?.(`  pbp ${s}: ${plays.length} scrimmage plays`);
    for (const p of plays) out.push(p);
  }
  return out;
}
