import type { AllSportsFeed } from "../feed";
import { oddsApiIoFeed } from "./oddsApiIo";
import { toaFeed } from "./toa";

/** Sports The Odds API carries; with both feeds on, odds-api.io fills in everything else. */
const TOA_SPORTS = new Set([
  "soccer", "tennis", "basketball", "football", "baseball", "hockey", "cricket", "rugby-league",
  "rugby-union", "aussie-rules", "boxing", "mma", "golf", "lacrosse", "handball",
]);

export interface ActiveFeed {
  feed: AllSportsFeed;
  /** Sports this feed is responsible for; null = every sport it lists. */
  sports: ((sport: string) => boolean) | null;
}

/**
 * Which feeds run. ALL_SPORTS_FEED = "toa" | "oddsapiio" | "both" forces it;
 * otherwise every feed with a key runs, and with both, The Odds API keeps its
 * sports and odds-api.io adds the rest (table tennis, darts, esports, …).
 */
export function activeFeeds(): ActiveFeed[] {
  const forced = process.env.ALL_SPORTS_FEED;
  const hasToa = Boolean(process.env.ODDS_API_KEY || process.env.PARLAY_API_KEY);
  const hasIo = Boolean(process.env.ODDS_API_IO_KEY);
  const toa = forced ? forced === "toa" || forced === "both" : hasToa;
  const io = forced ? forced === "oddsapiio" || forced === "both" : hasIo;
  const out: ActiveFeed[] = [];
  if (toa) out.push({ feed: toaFeed, sports: null });
  if (io) out.push({ feed: oddsApiIoFeed, sports: toa ? (s) => !TOA_SPORTS.has(s) : null });
  return out;
}
