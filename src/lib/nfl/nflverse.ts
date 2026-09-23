/**
 * Cached, hashed access to `nflverse/nflverse-data` release assets for offline
 * research scripts — never imported by an app route. One file per
 * (release tag, asset), stored under `.cache/nflverse/<tag>/` (gitignored) with a
 * per-tag `manifest.json` of SHA-256 digests, because nflverse silently
 * re-publishes historical files and an experiment must be able to say exactly
 * which bytes it ran on. Set `NFLVERSE_REFRESH=1` to re-download.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { CsvStreamParser } from "./pbp/csv";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export const NFLVERSE_CACHE_DIR = path.join(process.cwd(), ".cache", "nflverse");

export interface ManifestEntry {
  sha256: string;
  bytes: number;
  downloadedAt: string;
}

export function readManifest(tag: string): Record<string, ManifestEntry> {
  const p = path.join(NFLVERSE_CACHE_DIR, tag, "manifest.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, ManifestEntry>) : {};
}

/** In-progress season: its files change weekly, so they're re-downloaded once older than this. Historical seasons stay pinned to their hashed copy. */
const CURRENT_SEASON_MAX_AGE_MS = 3 * 3600_000;
let freshSeason: number | null = null;

/** Mark `season` as in progress, so its assets (and the season-less players/injuries files) refresh when stale. */
export function setInProgressSeason(season: number | null): void {
  freshSeason = season;
}

function isStale(dest: string, file: string): boolean {
  if (process.env.NFLVERSE_REFRESH === "1") return true;
  if (freshSeason === null) return false;
  const seasonMatch = file.match(/_(\d{4})\.csv/);
  const isCurrent = seasonMatch ? Number(seasonMatch[1]) === freshSeason : true;
  return isCurrent && Date.now() - statSync(dest).mtimeMs > CURRENT_SEASON_MAX_AGE_MS;
}

/** Download (once) and return the local path of a release asset. Returns null on HTTP 404 — some seasons simply don't exist for some tags. */
export async function downloadReleaseAsset(tag: string, file: string): Promise<string | null> {
  const dir = path.join(NFLVERSE_CACHE_DIR, tag);
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file);
  if (existsSync(dest) && !isStale(dest, file)) return dest;
  const res = await fetch(`${RELEASE_BASE}/${tag}/${file}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`nflverse ${tag}/${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  const manifest = readManifest(tag);
  manifest[file] = { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, downloadedAt: new Date().toISOString() };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dest;
}

/** Stream-parse a local CSV (plain or .gz), calling `onRow` with a column accessor for every data row. */
export async function streamCsv(file: string, onRow: (get: (col: string) => string | undefined) => void): Promise<void> {
  let index: Map<string, number> | null = null;
  const parser = new CsvStreamParser((row) => {
    if (!index) {
      index = new Map(row.map((c, i) => [c, i]));
      return;
    }
    const idx = index;
    onRow((col) => {
      const i = idx.get(col);
      return i === undefined ? undefined : row[i];
    });
  });
  const raw = createReadStream(file);
  const stream = file.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  stream.setEncoding("utf8");
  for await (const chunk of stream) parser.push(chunk as string);
  parser.end();
}

/** Download + parse an asset, keeping only `columns` (an explicit allow-list, so leakage columns never load). */
export async function loadReleaseCsv<C extends string>(tag: string, file: string, columns: readonly C[]): Promise<Record<C, string>[] | null> {
  const local = await downloadReleaseAsset(tag, file);
  if (!local) return null;
  const out: Record<C, string>[] = [];
  await streamCsv(local, (get) => {
    const rec = {} as Record<C, string>;
    for (const c of columns) rec[c] = get(c) ?? "";
    out.push(rec);
  });
  return out;
}

export const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
