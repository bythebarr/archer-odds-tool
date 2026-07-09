import type { SlateSport } from "@/lib/queries/slate";

/**
 * Single source of truth for sport display + routing. Shared by the Home
 * launcher cards, the SportRail quick-jump, and the /sports lobby so a new
 * sport is described in exactly one place.
 *
 * carriesDate: MLB's board is date-scoped, so its link carries the browsed
 * date; the others have no date filter.
 */
/**
 * Nav-level sport set. A superset of SlateSport: it adds sports that have a
 * page but no betting slate (F1 is results-only, no odds), so they can appear
 * in the rail/lobby without polluting the odds-driven SlateSport type.
 */
export type NavSport = SlateSport | "f1";

export type SportMeta = {
  sport: NavSport;
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

/**
 * Non-slate sports (a page, but no odds). Kept out of SPORT_META so anything
 * iterating the slate map stays odds-only; the nav map below folds them in.
 */
export const F1_META: SportMeta = {
  sport: "f1",
  label: "F1",
  icon: "🏁",
  href: "/f1",
  accent: "#e10600",
  carriesDate: false,
};

/** Every sport with a page — slate sports plus results-only ones. */
export const NAV_SPORT_META: Record<NavSport, SportMeta> = { ...SPORT_META, f1: F1_META };
export const NAV_SPORT_ORDER: NavSport[] = [...SPORT_ORDER, "f1"];

/** A sport's route, carrying the browsed date when the sport is date-scoped. */
export function sportHref(sport: NavSport, date: string): string {
  const meta = NAV_SPORT_META[sport];
  return meta.carriesDate ? `${meta.href}?date=${date}` : meta.href;
}
