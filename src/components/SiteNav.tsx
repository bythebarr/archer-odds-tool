"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { AppIconMark } from "@/lib/appIcon";
import { NAV_ITEMS, navHref, isNavActive } from "@/lib/nav";

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
          {/* Desktop: full sport list in the top bar. On mobile it's hidden —
              the fixed BottomNav carries the primary tabs instead. Horizontal
              scroll keeps the (wider) desktop list tidy if it ever overflows. */}
          <div className="hidden gap-1 overflow-x-auto [scrollbar-width:none] sm:flex [&::-webkit-scrollbar]:hidden">
            {NAV_ITEMS.map((link) => {
              const isActive = isNavActive(link, pathname);
              const href = navHref(link, date);
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
