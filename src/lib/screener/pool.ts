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
const cached = Object.fromEntries(
  SCREENER_SPORTS.map(({ key }) => [key, unstable_cache(() => BUILD[key](), ["screener-pool", key], { revalidate: 600, tags: ["screener-pool"] })])
) as Record<Sport, () => Promise<ScreenerProp[]>>;

/** Every sport's props, or one sport's. */
export async function getScreenerPool(sport: string | null): Promise<ScreenerProp[]> {
  const sports = SCREENER_SPORTS.map((s) => s.key).filter((k) => !sport || k === sport);
  const slices = await Promise.all(
    sports.map((s) =>
      cached[s]().catch((error) => {
        console.error(`screener pool ${s} failed`, error);
        return [] as ScreenerProp[];
      })
    )
  );
  return slices.flat();
}
