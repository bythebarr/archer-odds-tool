/**
 * The parlay builder's leg pool, one cached slice per source (NBA, NFL, UFC,
 * every other league). Building a slice reads a whole slate and replays its
 * models, so each is kept for a few minutes across requests and rebuilt in the
 * background after that; a source that fails leaves its slice empty rather
 * than taking the page down.
 */
import { unstable_cache } from "next/cache";
import type { BuilderLeg } from "./types";
import { teamLeagueLegs } from "./sources/teamLeague";
import { allSportsLegs } from "./sources/allSports";
import { ufcLegs } from "./sources/ufc";

export type PoolSource = "nba" | "nfl" | "ufc" | "all";
export const POOL_SOURCES: PoolSource[] = ["nba", "nfl", "ufc", "all"];

const BUILD: Record<PoolSource, () => Promise<BuilderLeg[]>> = {
  nba: () => teamLeagueLegs("nba"),
  nfl: () => teamLeagueLegs("nfl"),
  ufc: () => ufcLegs(),
  all: () => allSportsLegs(),
};

/** Fresh build, uncached (scripts and tests). */
export async function buildPoolSlice(source: PoolSource): Promise<BuilderLeg[]> {
  return BUILD[source]();
}

const cached = Object.fromEntries(
  POOL_SOURCES.map((s) => [s, unstable_cache(() => BUILD[s](), ["builder-pool", s], { revalidate: 600, tags: ["builder-pool"] })])
) as Record<PoolSource, () => Promise<BuilderLeg[]>>;

/** The legs from these sources (every source when empty). */
export async function getBuilderPool(sources: PoolSource[] = POOL_SOURCES): Promise<BuilderLeg[]> {
  const slices = await Promise.all(
    sources.map((s) =>
      cached[s]().catch((error) => {
        console.error(`builder pool ${s} failed`, error);
        return [] as BuilderLeg[];
      })
    )
  );
  return slices.flat();
}
