/**
 * Per-game play-level facts the box score doesn't carry, extracted in one
 * streaming pass over each season's raw nflverse play-by-play (research-only):
 *
 * - **Longest plays** per (game, player): longest reception, longest rush,
 *   longest completion thrown. Two-point tries are excluded, and so are
 *   penalty-nullified plays (their yardage columns are NA).
 * - **Every single-play gain**, pooled by player, so a player's single-play
 *   yardage distribution can be studied (kept per game for as-of use).
 * - **First touchdown** of each game, whoever scored it: offense, defense or
 *   special teams. It's the play with the lowest `play_id` where
 *   `touchdown == 1`, credited to `td_player_id`. Needed because first-TD
 *   props lose for every offensive player when a return or defensive TD comes
 *   first.
 *
 * Cached as `.cache/nflverse/pbp/extras_v<N>_<season>.json`, derived from
 * the same hashed raw files as `loader.ts`.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downloadReleaseAsset, streamCsv } from "../nflverse";
import { PBP_CACHE_DIR } from "./loader";

const EXTRAS_VERSION = 1;

export interface PlayerGameLongest {
  gameId: string;
  playerId: string;
  longestReception: number;
  longestRush: number;
  longestCompletion: number;
  /** Every reception / rush / completion gain this game (for single-play distributions). */
  receptions: number[];
  rushes: number[];
  completions: number[];
}

export interface GameFirstTd {
  gameId: string;
  /** GSIS id of the first TD scorer, or null if the game had no touchdown. */
  playerId: string | null;
  /** Team credited with the first TD (the scorer's team — a defensive/return TD belongs to the defense). */
  team: string | null;
}

export interface SeasonPlayExtras {
  longest: PlayerGameLongest[];
  firstTds: GameFirstTd[];
}

const COLUMNS = [
  "game_id", "play_id", "two_point_attempt", "complete_pass", "receiver_player_id", "receiving_yards",
  "rusher_player_id", "rushing_yards", "passer_player_id", "passing_yards", "touchdown", "td_player_id", "td_team",
] as const;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: string | undefined): string | null => (v === undefined || v === "" || v === "NA" ? null : v);

export async function loadSeasonPlayExtras(season: number): Promise<SeasonPlayExtras> {
  const cache = path.join(PBP_CACHE_DIR, `extras_v${EXTRAS_VERSION}_${season}.json`);
  const gz = await downloadReleaseAsset("pbp", `play_by_play_${season}.csv.gz`);
  if (!gz) throw new Error(`nflverse pbp ${season}: not published`);
  // Rebuild when the raw file was re-downloaded after the cache was written (the in-progress season).
  if (existsSync(cache) && statSync(cache).mtimeMs >= statSync(gz).mtimeMs) return JSON.parse(readFileSync(cache, "utf8")) as SeasonPlayExtras;

  const byKey = new Map<string, PlayerGameLongest>();
  const first = new Map<string, { playId: number; playerId: string | null; team: string | null }>();
  const games = new Set<string>();
  const entry = (gameId: string, playerId: string) => {
    const key = `${gameId}|${playerId}`;
    let e = byKey.get(key);
    if (!e) {
      e = { gameId, playerId, longestReception: 0, longestRush: 0, longestCompletion: 0, receptions: [], rushes: [], completions: [] };
      byKey.set(key, e);
    }
    return e;
  };

  const allowed = new Set<string>(COLUMNS);
  await streamCsv(gz, (raw) => {
    // allow-list: nothing outside COLUMNS (e.g. result, spread_line) is ever read
    const get = (c: (typeof COLUMNS)[number]) => (allowed.has(c) ? raw(c) : undefined);
    const gameId = get("game_id");
    if (!gameId) return;
    games.add(gameId);
    const playId = num(get("play_id")) ?? 0;
    if (get("touchdown") === "1") {
      const cur = first.get(gameId);
      if (!cur || playId < cur.playId) first.set(gameId, { playId, playerId: str(get("td_player_id")), team: str(get("td_team")) });
    }
    if (get("two_point_attempt") === "1") return;
    const recId = str(get("receiver_player_id"));
    const recYds = num(get("receiving_yards"));
    if (recId && recYds !== null && get("complete_pass") === "1") {
      const e = entry(gameId, recId);
      e.longestReception = Math.max(e.longestReception, recYds);
      e.receptions.push(recYds);
      const passer = str(get("passer_player_id"));
      const passYds = num(get("passing_yards"));
      if (passer && passYds !== null) {
        const p = entry(gameId, passer);
        p.longestCompletion = Math.max(p.longestCompletion, passYds);
        p.completions.push(passYds);
      }
    }
    const rushId = str(get("rusher_player_id"));
    const rushYds = num(get("rushing_yards"));
    if (rushId && rushYds !== null) {
      const e = entry(gameId, rushId);
      e.longestRush = Math.max(e.longestRush, rushYds);
      e.rushes.push(rushYds);
    }
  });

  const out: SeasonPlayExtras = {
    longest: [...byKey.values()],
    firstTds: [...games].map((gameId) => {
      const f = first.get(gameId);
      return { gameId, playerId: f?.playerId ?? null, team: f?.team ?? null };
    }),
  };
  writeFileSync(cache, JSON.stringify(out));
  return out;
}
