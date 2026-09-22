// Single source of truth for the app's primary navigation. Both the desktop
// SiteNav (full list) and the mobile BottomNav (primary subset) read from here
// so the two bars can't drift out of sync. The SPORT tabs derive from the sport
// registry (`SPORTS`) — label/icon/href/carriesDate come straight off each
// adapter's `meta`, so adding a sport surfaces it in nav automatically. The
// fixed non-sport tabs (Home, Slate, Props, the mobile hub) bracket them.
//
// carriesDate: MLB's Games/Slate views share a browsed date across nav clicks;
// Tennis/Soccer/F1 have no date filter, so they never carry one (from meta).
// primary: shows in the mobile BottomNav (a bottom bar shouldn't scroll).
// mobileOnly: hidden from the desktop top bar. The desktop nav lists every
// sport individually, so the "All Sports" hub tab would be redundant there —
// it exists only to give mobile a single door to the non-primary sports.
import { SPORT_METAS, type NavSport } from "@/lib/engine/sportsMeta";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  carriesDate: boolean;
  primary?: boolean;
  mobileOnly?: boolean;
};

/**
 * Sports that earn a mobile bottom-nav slot (the bar can't scroll, so it can't
 * list every sport). A nav-presentation choice, not sport identity — kept here,
 * typed to NavSport so it can't name a sport the registry doesn't have.
 */
const PRIMARY_SPORTS: ReadonlySet<NavSport> = new Set<NavSport>(["mlb", "ufc"]);

/** The per-sport tabs, derived from each sport's display meta (registry order). */
const SPORT_TABS: NavItem[] = SPORT_METAS.map((m) => ({
  href: m.href,
  label: m.label,
  icon: m.icon,
  carriesDate: m.carriesDate,
  ...(PRIMARY_SPORTS.has(m.sport) ? { primary: true } : {}),
}));

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠", carriesDate: true, primary: true },
  { href: "/slate", label: "Slate", icon: "📊", carriesDate: true, primary: true },
  ...SPORT_TABS,
  // CFB v0 is deliberately NOT a registry sport (see docs/architecture/CFB-V0.md
  // — no Prisma model, no Sport enum entry, no Game/Team rows), so it's a fixed
  // entry here rather than derived from SPORT_METAS, same as Props/Sports below.
  // TEMPORARY v0 debt: this hand-append means CFB is invisible to every
  // SPORT_METAS/registry consumer (SportRail, the /sports lobby, HomeLauncher,
  // the site's "every sport" copy) — those don't claim to be exhaustive over
  // every page in the app, only over the priced/graded sport product, so this
  // is a known gap, not a false claim, but it IS debt. Exit condition: fold
  // CFB into the registry only once a full adapter/storage/grading strategy
  // for it is approved (see CFB-V0.md's roadmap) — not before, since the
  // registry pulls in Prisma + the graded-play pipeline CFB v0 must not touch.
  { href: "/cfb", label: "CFB", icon: "🎓", carriesDate: true, primary: true },
  { href: "/props", label: "Props", icon: "🎯", carriesDate: false, primary: true },
  // Mobile-only hub: one door to every sport (incl. Tennis/Soccer/F1) so the
  // bottom bar stays focused instead of listing each sport as its own tab.
  { href: "/sports", label: "Sports", icon: "🏟️", carriesDate: true, primary: true, mobileOnly: true },
];

/** Desktop top bar: every sport individually, minus the mobile-only hub. */
export const DESKTOP_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.mobileOnly);
export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);

/** Resolve an item's href, carrying the browsed date when the item opts in. */
export function navHref(item: NavItem, date: string | null): string {
  return item.carriesDate && date ? `${item.href}?date=${date}` : item.href;
}

/** Home is active only on exact "/"; every other tab matches its subtree. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}
