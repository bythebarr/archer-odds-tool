/**
 * The parlay builder's leg pool, read from the pre-built pools
 * (lib/pools/snapshot): one pool per source (NBA, NFL, MLB, UFC, every other
 * league), in chunks small enough for one cache entry. A request never builds
 * a pool: it reads chunk rows (cached a minute) and, after responding, asks
 * for a rebuild of any pool that's gone stale. A source not built yet reads
 * empty rather than taking the page down.
 */
import { unstable_cache } from "next/cache";
import type { BuilderLeg } from "./types";
import { teamLeagueLegs } from "./sources/teamLeague";
import { allSportsLegs } from "./sources/allSports";
import { ufcLegs } from "./sources/ufc";
import { mlbLegs } from "./sources/mlb";
import { chunkKey, readChunk, refreshStalePools } from "@/lib/pools/snapshot";

export type PoolSource = "nba" | "nfl" | "mlb" | "ufc" | "all";
export const POOL_SOURCES: PoolSource[] = ["nba", "nfl", "mlb", "ufc", "all"];

/** Legs per chunk (an NBA slate runs ~1.1 MB for ~1,800 legs), and chunks per source. */
export const BUILDER_CHUNK_ROWS = 1500;
export const BUILDER_CHUNKS = 4;

const BUILD: Record<PoolSource, () => Promise<BuilderLeg[]>> = {
  nba: () => teamLeagueLegs("nba"),
  nfl: () => teamLeagueLegs("nfl"),
  mlb: () => mlbLegs(),
  ufc: () => ufcLegs(),
  all: () => allSportsLegs(),
};

/** Fresh build, uncached: the warm route (lib/pools/registry), scripts and tests. */
export async function buildPoolSlice(source: PoolSource): Promise<BuilderLeg[]> {
  return BUILD[source]();
}

const cached = Object.fromEntries(
  POOL_SOURCES.flatMap((s) =>
    Array.from({ length: BUILDER_CHUNKS }, (_, i) => {
      const k = chunkKey(`builder:${s}`, "all", i);
      return [k, unstable_cache(() => readChunk<BuilderLeg>(k), ["builder-snapshot", k], { revalidate: 60, tags: ["builder-pool"] })];
    })
  )
) as Record<string, () => Promise<BuilderLeg[]>>;

/** The legs from these sources (every source when empty). */
export async function getBuilderPool(sources: PoolSource[] = POOL_SOURCES): Promise<BuilderLeg[]> {
  await refreshStalePools(sources.map((s) => `builder:${s}`));
  const keys = sources.flatMap((s) => Array.from({ length: BUILDER_CHUNKS }, (_, i) => chunkKey(`builder:${s}`, "all", i)));
  const slices = await Promise.all(
    keys.map((k) =>
      cached[k]().catch((error) => {
        console.error(`builder pool ${k} failed`, error);
        return [] as BuilderLeg[];
      })
    )
  );
  return slices.flat();
}
