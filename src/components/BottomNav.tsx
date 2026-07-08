"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PRIMARY_NAV_ITEMS, navHref, isNavActive } from "@/lib/nav";

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
              className={`flex flex-1 flex-col items-center gap-1 pt-3.5 pb-6 text-[11px] font-medium transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span aria-hidden className="text-xl leading-none">
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
