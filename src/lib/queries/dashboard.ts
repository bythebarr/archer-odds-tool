import { getSlateForDate, type SlateSport, type SlateSide } from "./slate";
import { getOddsPoolForDate } from "./oddsPool";

/**
 * The home screen: a category launcher, not a leaderboard. It answers "what's
 * on today and where do I go" — a count per sport plus the next few events —
 * so the app opens as a springboard into each sport rather than a wall of
 * picks. The deep signal (leans, EV, the odds pool) lives on the sport pages
 * and the Slate; home just routes you there.
 */
export interface HomeSport {
  sport: SlateSport;
  count: number;
  /** Earliest (upcoming, else earliest overall) start for this sport today; null if none. */
  nextStartUtc: Date | null;
}

export interface HomeUpNext {
  key: string;
  sport: SlateSport;
  startUtc: Date;
  href: string;
  home: SlateSide;
  away: SlateSide;
}

export interface HomeData {
  date: string;
  total: number;
  /** Count of +value plays on the odds pool today (market lens) — the home's hook into the flagship value board. */
  edges: number;
  sports: HomeSport[];
  upNext: HomeUpNext[];
}

const SPORT_ORDER: SlateSport[] = ["mlb", "ufc", "tennis", "soccer"];

export async function getHomeForDate(dateEt: string, upNextSize = 5): Promise<HomeData> {
  const [slate, oddsPool] = await Promise.all([getSlateForDate(dateEt), getOddsPoolForDate(dateEt)]);
  const edges = oddsPool.plays.filter((p) => p.ev != null && p.ev > 0).length;

  const byStart = [...slate.items].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  const now = Date.now();
  const upcoming = byStart.filter((i) => i.startUtc.getTime() >= now);
  const pool = upcoming.length ? upcoming : byStart; // late-night fallback: show the day's card

  const sports: HomeSport[] = SPORT_ORDER.map((sport) => ({
    sport,
    count: slate.counts[sport],
    nextStartUtc: (upcoming.find((i) => i.sport === sport) ?? byStart.find((i) => i.sport === sport))?.startUtc ?? null,
  }));

  const upNext: HomeUpNext[] = pool.slice(0, upNextSize).map((i) => ({
    key: i.key,
    sport: i.sport,
    startUtc: i.startUtc,
    href: i.href,
    home: i.home,
    away: i.away,
  }));

  return { date: dateEt, total: slate.items.length, edges, sports, upNext };
}
