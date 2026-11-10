/**
 * Every pre-built pool (lib/pools/snapshot): its name, and how to build it
 * into chunk parts. Server-only: building reads whole slates.
 */
import { mlbScreener, nbaScreener, nflScreener, soccerScreener, tennisScreener, ufcScreener } from "@/lib/screener/sources";
import type { ScreenerProp } from "@/lib/screener/types";
import { BUILDER_CHUNKS, BUILDER_CHUNK_ROWS, buildPoolSlice, POOL_SOURCES, type PoolSource } from "@/lib/builder/pool";
import { chunkRows } from "./snapshot";
import { SCREENER_CHUNKS, SCREENER_CHUNK_ROWS, SCREENER_SPORTS, type ScreenerSport } from "@/lib/screener/pool";

const SCREENER_BUILD: Record<ScreenerSport, () => Promise<ScreenerProp[]>> = {
  nba: nbaScreener,
  nfl: nflScreener,
  soccer: () => soccerScreener(),
  mlb: mlbScreener,
  ufc: () => ufcScreener(),
  tennis: tennisScreener,
};

export const screenerPoolKey = (sport: ScreenerSport) => `screener:${sport}`;
export const builderPoolKey = (source: PoolSource) => `builder:${source}`;

type Build = () => Promise<Record<string, unknown[][]>>;

export const POOLS: Record<string, Build> = {
  ...Object.fromEntries(
    SCREENER_SPORTS.map(({ key }) => [
      screenerPoolKey(key),
      async () => {
        const rows = await SCREENER_BUILD[key]();
        return {
          main: chunkRows(rows.filter((p) => p.main), SCREENER_CHUNK_ROWS, SCREENER_CHUNKS),
          alt: chunkRows(rows.filter((p) => !p.main), SCREENER_CHUNK_ROWS, SCREENER_CHUNKS),
        };
      },
    ])
  ),
  ...Object.fromEntries(
    POOL_SOURCES.map((s) => [builderPoolKey(s), async () => ({ all: chunkRows(await buildPoolSlice(s), BUILDER_CHUNK_ROWS, BUILDER_CHUNKS) })])
  ),
};

export const POOL_KEYS = Object.keys(POOLS);
