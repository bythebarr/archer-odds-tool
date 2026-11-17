/**
 * The screener's props, read from the pre-built pools (lib/pools/snapshot):
 * one pool per sport, stored as main lines and alt rungs apart, each part in
 * chunks small enough for one cache entry. A request never builds a pool: it
 * reads chunk rows (cached a minute) and, after responding, asks for a
 * rebuild of any pool that's gone stale. A chunk not built yet reads empty.
 */
import { unstable_cache } from "next/cache";
import type { ScreenerProp } from "./types";
import { chunkKey, readChunk, refreshStalePools } from "@/lib/pools/snapshot";

export const SCREENER_SPORTS = [
  { key: "nba", label: "NBA" },
  { key: "nfl", label: "NFL" },
  { key: "soccer", label: "Soccer" },
  { key: "mlb", label: "MLB" },
  { key: "ufc", label: "UFC" },
  { key: "tennis", label: "Tennis" },
] as const;
export type ScreenerSport = (typeof SCREENER_SPORTS)[number]["key"];

/**
 * Rows per chunk, and chunks per part. Each chunk is one unstable_cache entry,
 * and Next refuses to store an entry over 2 MB: it logs a warning and keeps
 * serving the OLD entry, so an oversized chunk freezes the page on whatever
 * slate it last stored (the NBA main chunk ran 1.86 MB at 2,500 rows on
 * 2026-11-13). 1,000 rows (~0.75 MB) leaves headroom; ten chunks keep the
 * same 10,000-row reach.
 */
export const SCREENER_CHUNK_ROWS = 1000;
export const SCREENER_CHUNKS = 10;

type Part = "main" | "alt";

const cached = Object.fromEntries(
  SCREENER_SPORTS.flatMap(({ key }) =>
    (["main", "alt"] as Part[]).flatMap((part) =>
      Array.from({ length: SCREENER_CHUNKS }, (_, i) => {
        const k = chunkKey(`screener:${key}`, part, i);
        return [k, unstable_cache(() => readChunk<ScreenerProp>(k), ["screener-snapshot", k], { revalidate: 60, tags: ["screener-pool"] })];
      })
    )
  )
) as Record<string, () => Promise<ScreenerProp[]>>;

/** Every sport's props, or one sport's; alt rungs only when asked for. */
export async function getScreenerPool(sport: string | null, withAlts: boolean): Promise<ScreenerProp[]> {
  const sports = SCREENER_SPORTS.map((s) => s.key).filter((k) => !sport || k === sport);
  await refreshStalePools(sports.map((s) => `screener:${s}`));
  const parts: Part[] = withAlts ? ["main", "alt"] : ["main"];
  const keys = sports.flatMap((s) => parts.flatMap((p) => Array.from({ length: SCREENER_CHUNKS }, (_, i) => chunkKey(`screener:${s}`, p, i))));
  const slices = await Promise.all(
    keys.map((k) =>
      cached[k]().catch((error) => {
        console.error(`screener pool ${k} failed`, error);
        return [] as ScreenerProp[];
      })
    )
  );
  return [...new Map(slices.flat().map((p) => [p.id, p])).values()];
}
