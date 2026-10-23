"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { ArchrWordmark } from "@/components/brand/ArchrWordmark";
import { Glyph } from "@/components/brand/Glyph";
import { DESKTOP_NAV_ITEMS, navHref, isNavActive } from "@/lib/nav";

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
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" aria-label="ARCHR Edge home" className="flex shrink-0 items-center">
            <ArchrWordmark />
          </Link>
          {/* Desktop: full sport list in the top bar. On mobile it's hidden —
              the fixed BottomNav carries the primary tabs instead. Horizontal
              scroll keeps the (wider) desktop list tidy if it ever overflows. */}
          <div className="hidden gap-1 overflow-x-auto [scrollbar-width:none] sm:flex [&::-webkit-scrollbar]:hidden">
            {DESKTOP_NAV_ITEMS.map((link) => {
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
                  <Glyph name={link.icon} className="size-4" />
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
