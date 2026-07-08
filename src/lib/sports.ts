import type { SlateSport } from "@/lib/queries/slate";

/**
 * Single source of truth for sport display + routing. Shared by the Home
 * launcher cards, the SportRail quick-jump, and the /sports lobby so a new
 * sport is described in exactly one place.
 *
 * carriesDate: MLB's board is date-scoped, so its link carries the browsed
 * date; the others have no date filter.
 */
export type SportMeta = {
  sport: SlateSport;
  label: string;
  icon: string;
  href: string;
  accent: string;
  carriesDate: boolean;
};

export const SPORT_META: Record<SlateSport, SportMeta> = {
  mlb: { sport: "mlb", label: "MLB", icon: "⚾", href: "/mlb", accent: "#3b82f6", carriesDate: true },
  ufc: { sport: "ufc", label: "UFC", icon: "🥊", href: "/ufc", accent: "#ef4444", carriesDate: false },
  tennis: { sport: "tennis", label: "Tennis", icon: "🎾", href: "/tennis", accent: "#a3e635", carriesDate: false },
  soccer: { sport: "soccer", label: "Soccer", icon: "⚽", href: "/soccer", accent: "#10b981", carriesDate: false },
};

export const SPORT_ORDER: SlateSport[] = ["mlb", "ufc", "tennis", "soccer"];

/** A sport's route, carrying the browsed date when the sport is date-scoped. */
export function sportHref(sport: SlateSport, date: string): string {
  const meta = SPORT_META[sport];
  return meta.carriesDate ? `${meta.href}?date=${date}` : meta.href;
}
