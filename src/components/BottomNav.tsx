"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PRIMARY_NAV_ITEMS, navHref, isNavActive } from "@/lib/nav";
import { Glyph } from "@/components/brand/Glyph";

// The primary mobile destinations — a focused set (a bottom bar shouldn't
// scroll), defined once in @/lib/nav so this can't drift from the desktop
// SiteNav. Individual sports beyond the flagship few (Tennis/Soccer/F1) live
// behind the "Sports" hub tab, which opens the /sports lobby.

/**
 * Fixed bottom tab bar — the mobile app shell. Hidden on `sm+` (the top
 * SiteNav carries the full sport list there). Mirrors SiteNav's date carry-over
 * so Home/Slate/MLB keep the browsed date.
 */
export function BottomNav() {
  const pathname = usePathname();
  const date = useSearchParams().get("date");

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {PRIMARY_NAV_ITEMS.map((tab) => {
          const isActive = isNavActive(tab, pathname);
          const href = navHref(tab, date);
          return (
            <Link
              key={tab.href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 pt-3 pb-6 text-[11px] font-semibold transition-colors ${
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {/* Active tab: a short volt stroke at the arrow's angle. */}
              {isActive && <span aria-hidden className="absolute top-0 h-[3px] w-7 -skew-x-[18deg] rounded-b-sm bg-brand" />}
              <Glyph name={tab.icon} className="size-6" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
