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
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { CsvStreamParser } from "./csv";
import { franchise } from "./franchise";
import type { NflPlay } from "./types";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download/pbp";
/** Bump when `NflPlay`'s shape or the allow-list changes, so stale reduced caches are ignored. */
const REDUCED_VERSION = 1;

export const PBP_CACHE_DIR = path.join(process.cwd(), ".cache", "nflverse", "pbp");

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

interface ManifestEntry {
  sha256: string;
  bytes: number;
  downloadedAt: string;
}

function manifestPath(): string {
  return path.join(PBP_CACHE_DIR, "manifest.json");
}

export function readPbpManifest(): Record<string, ManifestEntry> {
  const p = manifestPath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, ManifestEntry>) : {};
}

async function download(season: number): Promise<string> {
  const file = `play_by_play_${season}.csv.gz`;
  const dest = path.join(PBP_CACHE_DIR, file);
  if (existsSync(dest) && process.env.NFLVERSE_REFRESH !== "1") return dest;
  const res = await fetch(`${RELEASE_BASE}/${file}`);
  if (!res.ok) throw new Error(`nflverse pbp ${season}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  const manifest = readPbpManifest();
  manifest[file] = {
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
    downloadedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2));
  return dest;
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
  let index: Map<Col, number> | null = null;
  const parser = new CsvStreamParser((row) => {
    if (!index) {
      index = new Map();
      for (const c of PBP_ALLOWED_COLUMNS) {
        const i = row.indexOf(c);
        if (i >= 0) index.set(c, i);
      }
      return;
    }
    const idx = index;
    const play = toPlay((c) => {
      const i = idx.get(c);
      return i === undefined ? undefined : row[i];
    });
    if (play) plays.push(play);
  });
  const stream = createReadStream(gzPath).pipe(createGunzip());
  stream.setEncoding("utf8");
  for await (const chunk of stream) parser.push(chunk as string);
  parser.end();
  return plays;
}

/** Load one season's scrimmage plays, downloading and reducing on first use. */
export async function loadSeasonPlays(season: number): Promise<NflPlay[]> {
  mkdirSync(PBP_CACHE_DIR, { recursive: true });
  const reduced = path.join(PBP_CACHE_DIR, `plays_v${REDUCED_VERSION}_${season}.json`);
  if (existsSync(reduced) && process.env.NFLVERSE_REFRESH !== "1") {
    return JSON.parse(readFileSync(reduced, "utf8")) as NflPlay[];
  }
  const gz = await download(season);
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
