import { getSlateForDate } from "./slate";
import { getNextRace } from "./f1";
import { SPORT_ORDER, type NavSport } from "@/lib/sports";

/** Per-sport "what's on today" for the rail + lobby: count and next start. */
export interface SportNavItem {
  sport: NavSport;
  count: number;
  nextStartUtc: Date | null;
}

// F1 has no daily slate; it reads as "on deck" only in the days around a race.
const F1_ON_DECK_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Lightweight sport-nav data — reuses the (request-cached) slate, so it's free
 * on pages that already load it. Same in-season logic as getHomeForDate: a
 * sport's next start is its earliest upcoming event, else its earliest today.
 */
export async function getSportNav(dateEt: string): Promise<SportNavItem[]> {
  const slate = await getSlateForDate(dateEt);
  const now = Date.now();
  const byStart = [...slate.items].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  const upcoming = byStart.filter((i) => i.startUtc.getTime() >= now);

  const slateItems: SportNavItem[] = SPORT_ORDER.map((sport) => ({
    sport,
    count: slate.counts[sport],
    nextStartUtc:
      (upcoming.find((i) => i.sport === sport) ?? byStart.find((i) => i.sport === sport))?.startUtc ?? null,
  }));

  // F1 rides its own results feed, not the slate — surface the next Grand Prix
  // and mark it "on deck" (count 1) only when it's within race week.
  const nextRace = await getNextRace();
  const f1OnDeck = nextRace != null && nextRace.raceDate.getTime() - now <= F1_ON_DECK_MS;
  const f1Item: SportNavItem = {
    sport: "f1",
    count: f1OnDeck ? 1 : 0,
    nextStartUtc: nextRace?.raceDate ?? null,
  };

  return [...slateItems, f1Item];
}
