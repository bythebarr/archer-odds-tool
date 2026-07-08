import { getSlateForDate, type SlateSport } from "./slate";
import { SPORT_ORDER } from "@/lib/sports";

/** Per-sport "what's on today" for the rail + lobby: count and next start. */
export interface SportNavItem {
  sport: SlateSport;
  count: number;
  nextStartUtc: Date | null;
}

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

  return SPORT_ORDER.map((sport) => ({
    sport,
    count: slate.counts[sport],
    nextStartUtc:
      (upcoming.find((i) => i.sport === sport) ?? byStart.find((i) => i.sport === sport))?.startUtc ?? null,
  }));
}
