// Single source of truth for the app's primary navigation. Both the desktop
// SiteNav and the mobile BottomNav read from here so the two bars can't drift
// out of sync. The sportsbook layout: Home, then each in-season sport, then
// Props. The SPORT tabs derive from the sport registry (`SPORT_METAS`, parked
// sports excluded), so adding or un-parking a sport surfaces it automatically.
//
// carriesDate: a tab that keeps the browsed date across nav clicks.
// primary: shows in the mobile BottomNav (a bottom bar shouldn't scroll).
// mobileOnly: hidden from the desktop top bar.
import { SPORT_METAS, type NavSport } from "@/lib/engine/sportsMeta";
import type { GlyphKey } from "@/components/brand/Glyph";

export type NavItem = {
  href: string;
  label: string;
  icon: GlyphKey;
  carriesDate: boolean;
  primary?: boolean;
  mobileOnly?: boolean;
};

/**
 * Sports that earn a mobile bottom-nav slot (the bar can't scroll, so it can't
 * list every sport). A nav-presentation choice, not sport identity — kept here,
 * typed to NavSport so it can't name a sport the registry doesn't have.
 */
const PRIMARY_SPORTS: ReadonlySet<NavSport> = new Set<NavSport>(["nba", "nfl", "ufc"]);

/** The per-sport tabs, derived from each sport's display meta (registry order). */
const SPORT_TABS: NavItem[] = SPORT_METAS.filter((m) => !m.parked).map((m) => ({
  href: m.href,
  label: m.label,
  icon: m.sport,
  carriesDate: m.carriesDate,
  ...(PRIMARY_SPORTS.has(m.sport) ? { primary: true } : {}),
}));

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "home", carriesDate: false, primary: true },
  ...SPORT_TABS,
  // Every other sport and league, from the all-sports engine.
  { href: "/sports", label: "All Sports", icon: "all", carriesDate: false, primary: true },
  // Props opens the all-sports props hub, one door per sport. (The old MLB props
  // board at /props is still reachable by URL.)
  { href: "/player-props", label: "Props", icon: "props", carriesDate: false, primary: true },
  // Cross-sport parlays from the legs that clear your bars (desktop nav; the props hub links it on mobile).
  { href: "/parlay-builder", label: "Parlay Builder", icon: "props", carriesDate: false },
];

/**
 * The Slate and the /sports hub left the nav with the sportsbook layout: the
 * sport carousel at the top of Home and every league page is the way between
 * sports now (parked ones included). Both routes still work by URL.
 */
export const DESKTOP_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.mobileOnly);
export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);

/** Resolve an item's href, carrying the browsed date when the item opts in. */
export function navHref(item: NavItem, date: string | null): string {
  return item.carriesDate && date ? `${item.href}?date=${date}` : item.href;
}

function matches(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Home is active only on exact "/"; every other tab matches its subtree — and
 * when two tabs match, only the more specific one lights up.
 */
export function isNavActive(item: NavItem, pathname: string, items: NavItem[] = NAV_ITEMS): boolean {
  if (!matches(item, pathname)) return false;
  return !items.some((other) => other.href.length > item.href.length && matches(other, pathname));
}
