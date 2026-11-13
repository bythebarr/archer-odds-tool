/**
 * Every pre-built pool (lib/pools/snapshot): its name, and how to build it
 * into chunk parts. Server-only: building reads whole slates.
 */
import { mlbScreener, nbaScreener, nflScreener, soccerScreener, tennisScreener, ufcScreener } from "@/lib/screener/sources";
import type { ScreenerProp } from "@/lib/screener/types";
import { BUILDER_CHUNKS, BUILDER_CHUNK_ROWS, buildPoolSlice, POOL_SOURCES, type PoolSource } from "@/lib/builder/pool";
import { chunkRows } from "./snapshot";
import { poolConfidence, recordOf } from "./confidence";
import { getReportedBlendVerdicts, getReportedGraded } from "@/lib/queries/modelTrust";
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
        const [built, verdicts, graded] = await Promise.all([SCREENER_BUILD[key](), getReportedBlendVerdicts(), getReportedGraded()]);
        const rows = built.map(({ facts, ...r }) => ({
          ...r,
          confidence: poolConfidence(
            {
              sport: r.sport,
              statKey: r.stat,
              archr: r.archr,
              priceAmerican: r.priceAmerican,
              rate: recordOf(r.rates.l10, r.rates.szn),
              fallbackGames: r.rates.szn[1] + r.rates.last[1],
              alt: !r.main,
              projectedMinutes: r.minutes ?? null,
              facts,
            },
            verdicts,
            graded
          ),
        }));
        return {
          main: chunkRows(rows.filter((p) => p.main), SCREENER_CHUNK_ROWS, SCREENER_CHUNKS),
          alt: chunkRows(rows.filter((p) => !p.main), SCREENER_CHUNK_ROWS, SCREENER_CHUNKS),
        };
      },
    ])
  ),
  ...Object.fromEntries(
    POOL_SOURCES.map((s) => [
      builderPoolKey(s),
      async () => {
        const [built, verdicts, graded] = await Promise.all([buildPoolSlice(s), getReportedBlendVerdicts(), getReportedGraded()]);
        const legs = built.map(({ facts, ...l }) =>
          l.kind !== "prop"
            ? l
            : {
                ...l,
                confidence: poolConfidence(
                  {
                    sport: l.sport,
                    // Prop leg ids are "<sport>:prop:<player>:<stat>:<side>:<point>".
                    statKey: l.id.split(":")[3] ?? "",
                    archr: l.archr,
                    priceAmerican: l.priceAmerican,
                    rate: recordOf(l.rates.l10, l.rates.season),
                    fallbackGames: l.rates.season[1],
                    alt: false,
                    projectedMinutes: facts?.projectedMinutes ?? null,
                    facts,
                  },
                  verdicts,
                  graded
                ),
              }
        );
        return { all: chunkRows(legs, BUILDER_CHUNK_ROWS, BUILDER_CHUNKS) };
      },
    ])
  ),
};

export const POOL_KEYS = Object.keys(POOLS);
