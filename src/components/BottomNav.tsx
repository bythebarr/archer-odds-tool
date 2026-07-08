"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// The primary mobile destinations — a focused 5 (a bottom bar shouldn't scroll).
// Tennis/Soccer stay one tap away via the Home dashboard's sport tiles and the
// desktop top-nav, which keeps every sport listed.
const TABS = [
  { href: "/", label: "Home", icon: "🏠", carriesDate: true },
  { href: "/slate", label: "Slate", icon: "📊", carriesDate: true },
  { href: "/mlb", label: "MLB", icon: "⚾", carriesDate: true },
  { href: "/ufc", label: "UFC", icon: "🥊", carriesDate: false },
  { href: "/props", label: "Props", icon: "🎯", carriesDate: false },
];

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
        {TABS.map((tab) => {
          const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const href = tab.carriesDate && date ? `${tab.href}?date=${date}` : tab.href;
          return (
            <Link
              key={tab.href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
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
