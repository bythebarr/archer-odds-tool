// Single source of truth for the app's primary navigation. Both the desktop
// SiteNav (full list) and the mobile BottomNav (primary subset) read from here
// so the two bars can't drift out of sync.
//
// carriesDate: MLB's Games/Slate views share a browsed date across nav clicks;
// Tennis/Soccer have no date filter, so they never carry one.
// icon: a scannable sport glyph, DraftKings-style.
// primary: shows in the mobile BottomNav's focused 5 (a bottom bar shouldn't
// scroll). Tennis/Soccer stay one tap away via Home tiles + the desktop nav.
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  carriesDate: boolean;
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠", carriesDate: true, primary: true },
  { href: "/slate", label: "Slate", icon: "📊", carriesDate: true, primary: true },
  { href: "/mlb", label: "MLB", icon: "⚾", carriesDate: true, primary: true },
  { href: "/ufc", label: "UFC", icon: "🥊", carriesDate: false, primary: true },
  { href: "/tennis", label: "Tennis", icon: "🎾", carriesDate: false },
  { href: "/soccer", label: "Soccer", icon: "⚽", carriesDate: false },
  { href: "/props", label: "Props", icon: "🎯", carriesDate: false, primary: true },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);

/** Resolve an item's href, carrying the browsed date when the item opts in. */
export function navHref(item: NavItem, date: string | null): string {
  return item.carriesDate && date ? `${item.href}?date=${date}` : item.href;
}

/** Home is active only on exact "/"; every other tab matches its subtree. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}
