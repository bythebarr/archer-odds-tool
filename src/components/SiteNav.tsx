"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { AppIconMark } from "@/lib/appIcon";

// carriesDate: MLB's Games/Slate views share a browsed date across nav
// clicks; Tennis/Soccer have no date filter (see tennisMatches.ts /
// soccerMatches.ts), so they never carry one.
// icon: a scannable sport glyph, DraftKings-style — makes the nav readable
// at a glance and adds a bit of color to the "data-terminal" palette.
const NAV_LINKS = [
  { href: "/", label: "Games", icon: "⚾", carriesDate: true },
  { href: "/slate", label: "Slate", icon: "📊", carriesDate: true },
  { href: "/tennis", label: "Tennis", icon: "🎾", carriesDate: false },
  { href: "/soccer", label: "Soccer", icon: "⚽", carriesDate: false },
  { href: "/props", label: "Props", icon: "🎯", carriesDate: false },
];

/**
 * Carries the currently-browsed `date` across nav links so switching
 * between the Games and Slate views doesn't reset you back to today.
 */
export function SiteNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const date = searchParams.get("date");

  return (
    <nav className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-mono text-sm font-semibold text-foreground">
            <span className="block h-[18px] w-[18px] overflow-hidden rounded-[22%]">
              <AppIconMark />
            </span>
            archer
          </Link>
          {/* Horizontal scroll keeps all five sports reachable on a phone
              without wrapping the row; scrollbar is hidden for a clean edge. */}
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_LINKS.map((link) => {
              const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              const href = link.carriesDate && date ? `${link.href}?date=${date}` : link.href;
              return (
                <Link
                  key={link.href}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span aria-hidden className="text-[13px] leading-none">{link.icon}</span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
