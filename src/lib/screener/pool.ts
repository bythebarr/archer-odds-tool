/**
 * The screener's props, one cached slice per sport (a slice reads a whole slate
 * and replays its props model, so it's kept ten minutes across requests); a
 * sport that fails leaves its slice empty rather than taking the page down.
 */
import { unstable_cache } from "next/cache";
import type { ScreenerProp } from "./types";
import { nbaScreener, nflScreener, soccerScreener } from "./sources";

export const SCREENER_SPORTS = [
  { key: "nba", label: "NBA" },
  { key: "nfl", label: "NFL" },
  { key: "soccer", label: "Soccer" },
] as const;
type Sport = (typeof SCREENER_SPORTS)[number]["key"];

const BUILD: Record<Sport, () => Promise<ScreenerProp[]>> = { nba: nbaScreener, nfl: nflScreener, soccer: () => soccerScreener() };

/** One build serves both parts of a sport's slice when they refresh together. */
const building = new Map<Sport, { at: number; rows: Promise<ScreenerProp[]> }>();
function build(sport: Sport): Promise<ScreenerProp[]> {
  const hit = building.get(sport);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = BUILD[sport]();
  building.set(sport, { at: Date.now(), rows });
  return rows;
}

/**
 * Each sport is cached as main lines and alt rungs apart (the default screen
 * needs only main lines), and each part in chunks of CHUNK_ROWS, since a whole
 * slice can pass the cache's 2 MB an entry (soccer's main lines run ~3 MB).
 */
type Part = "main" | "alt";
const CHUNK_ROWS = 2500;
const CHUNKS = 4;
const cached = Object.fromEntries(
  SCREENER_SPORTS.flatMap(({ key }) =>
    (["main", "alt"] as Part[]).flatMap((part) =>
      Array.from({ length: CHUNKS }, (_, i) => [
        `${key}:${part}:${i}`,
        unstable_cache(
          async () => (await build(key)).filter((p) => p.main === (part === "main")).slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS),
          ["screener-pool", key, part, String(i)],
          { revalidate: 600, tags: ["screener-pool"] }
        ),
      ])
    )
  )
) as Record<string, () => Promise<ScreenerProp[]>>;

/** Every sport's props, or one sport's; alt rungs only when asked for. */
export async function getScreenerPool(sport: string | null, withAlts: boolean): Promise<ScreenerProp[]> {
  const sports = SCREENER_SPORTS.map((s) => s.key).filter((k) => !sport || k === sport);
  const parts: Part[] = withAlts ? ["main", "alt"] : ["main"];
  const keys = sports.flatMap((s) => parts.flatMap((p) => Array.from({ length: CHUNKS }, (_, i) => `${s}:${p}:${i}`)));
  const slices = await Promise.all(
    keys.map((k) =>
      cached[k]().catch((error) => {
        console.error(`screener pool ${k} failed`, error);
        return [] as ScreenerProp[];
      })
    )
  );
  // Chunks refreshed at different moments can overlap: each prop once.
  return [...new Map(slices.flat().map((p) => [p.id, p])).values()];
}
